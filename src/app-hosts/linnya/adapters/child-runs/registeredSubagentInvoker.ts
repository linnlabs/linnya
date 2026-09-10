import type { PromptKey } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { generateSubrunId, runIdFromSubrunId, type RunId } from '@linnlabs/linnkit/contracts';
import { childRuns, tools } from '@linnlabs/linnkit/runtime-kernel';
import { recordRunTranscript, runWithLlmAuditContext } from 'src/domains/audit';
import { createLinnyaChildRunInvoker } from './childRunInvokerFactory';
import {
  LinnyaRegisteredChildRunLifecycle,
  type RegisteredChildRunLifecyclePort,
} from './childRunLifecycle';
import type { RegisteredAgentResolverPort } from './registeredAgentResolver';
import { createDefaultRegisteredAgentResolver } from './registeredAgentResolver';
import type { LinnyaAgentRuntimeScope } from 'src/app-hosts/linnya/adapters/runtime-assembly/agentRuntimeScope';
import type { telemetry } from '@linnlabs/linnkit/runtime-kernel';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
} from '@app/schemas/commands';
import type {
  CommandAgentRunEndBarrier,
  CommandAgentRunLifecyclePort,
} from 'src/app-hosts/linnya/adapters/commands/process-owner';
import { getLogger } from 'src/shared/logger';

const logger = getLogger('RegisteredChildRunInvoker');

type RegisteredChildRunParentContext = childRuns.ChildRunInvokeConfig['parentToolContext'];

export interface RegisteredChildRunRequest
  extends childRuns.ChildRunRequest<RegisteredChildRunParentContext> {
  promptKey: PromptKey;
}

export interface RegisteredChildRunResult extends childRuns.ChildRunResult {
  promptKey: PromptKey;
}

export type RegisteredChildRunInvokerPort = childRuns.ChildRunInvokerPort<
  RegisteredChildRunRequest,
  RegisteredChildRunResult
>;

function toRegisteredChildRunParentContext(
  context: RegisteredChildRunParentContext
): RegisteredChildRunParentContext {
  return context;
}

function resolveAbortSignal(params: RegisteredChildRunRequest): AbortSignal | undefined {
  return params.executionPolicy?.abortSignal ?? params.parentToolContext.abortSignal;
}

function resolveMaxSteps(
  params: RegisteredChildRunRequest,
  agentDefinition: AgentDefinition,
): number | undefined {
  return params.executionPolicy?.maxSteps ?? agentDefinition.config?.maxSteps;
}

function resolveModelId(
  params: RegisteredChildRunRequest,
  agentDefinition: AgentDefinition
): string | undefined {
  const explicitModelId = params.executionPolicy?.modelId;
  if (typeof explicitModelId === 'string' && explicitModelId.trim().length > 0) {
    return explicitModelId.trim();
  }

  if (agentDefinition.config?.modelPolicy?.kind !== 'inherit_parent') {
    return undefined;
  }

  const parentModelId = params.parentToolContext.modelId;
  if (typeof parentModelId === 'string' && parentModelId.trim().length > 0) {
    return parentModelId.trim();
  }

  throw new Error(
    `[RegisteredChildRunInvoker] agent ${agentDefinition.id} requires parentToolContext.modelId to inherit the parent model`
  );
}

function createSubrunTracePublisher(params: RegisteredChildRunRequest) {
  const { parentToolContext, tracePolicy } = params;
  const parentToolCallId = tracePolicy?.parentToolCallId ?? parentToolContext.parentToolCallId;
  if (!parentToolCallId || typeof parentToolContext.createSubRunTracePublisher !== 'function') {
    return undefined;
  }

  const subrunId = tracePolicy?.subrunId ?? generateSubrunId();
  return {
    subrunId,
    publisher: parentToolContext.createSubRunTracePublisher({
      parentToolCallId,
      subrunId,
      source: tracePolicy?.source,
      metadata: tracePolicy?.metadata,
    }),
  };
}

function resolveChildRunId(params: RegisteredChildRunRequest, subrunId: string): RunId {
  const explicitRunId = params.executionPolicy?.runId;
  if (explicitRunId !== undefined) {
    return explicitRunId;
  }
  return runIdFromSubrunId(subrunId);
}

function resolveParentRunId(params: RegisteredChildRunRequest): RunId | undefined {
  const explicitParentRunId = params.executionPolicy?.parentRunId;
  if (explicitParentRunId !== undefined) {
    return explicitParentRunId;
  }
  return params.parentToolContext.runId;
}

function resolveConversationId(params: RegisteredChildRunRequest): string | undefined {
  const explicitConversationId = params.executionPolicy?.conversationId;
  if (typeof explicitConversationId === 'string' && explicitConversationId.trim().length > 0) {
    return explicitConversationId.trim();
  }
  const contextConversationId = params.parentToolContext.conversationId;
  return typeof contextConversationId === 'string' && contextConversationId.trim().length > 0
    ? contextConversationId.trim()
    : undefined;
}

function requireConversationIdForLifecycle(
  conversationId: string | undefined,
  childRunId: string
): string {
  if (conversationId) {
    return conversationId;
  }
  throw new Error(
    `[RegisteredChildRunInvoker] parentToolContext.conversationId is required before starting child run ${childRunId}`
  );
}

function requireParentRunIdForLifecycle(parentRunId: RunId | undefined, childRunId: RunId): RunId {
  if (parentRunId) {
    return parentRunId;
  }
  throw new Error(
    `[RegisteredChildRunInvoker] parentToolContext.runId or executionPolicy.parentRunId is required before starting child run ${childRunId}`
  );
}

function toRegisteredChildRunResult(params: {
  promptKey: PromptKey;
  subrunId: string;
  result: childRuns.ChildRunInvokeResult;
}): RegisteredChildRunResult {
  const { promptKey, subrunId, result } = params;
  return {
    promptKey,
    ...(typeof result.runId === 'string' ? { runId: result.runId } : {}),
    ...(typeof result.parentRunId === 'string' ? { parentRunId: result.parentRunId } : {}),
    subrunId,
    success: result.success,
    ...(result.cancelled ? { cancelled: true } : {}),
    finalAnswer: typeof result.finalAnswer === 'string' ? result.finalAnswer : '',
    ...(typeof result.lastProgress === 'string' ? { lastProgress: result.lastProgress } : {}),
    events: result.events,
    stepCount: result.stepCount,
    ...(typeof result.error === 'string' && result.error.trim().length > 0
      ? { error: result.error }
      : {}),
    ...(typeof result.judgeToolOutput === 'string'
      ? { judgeToolOutput: result.judgeToolOutput }
      : {}),
  };
}

export class RegisteredChildRunInvoker implements RegisteredChildRunInvokerPort {
  private readonly agentResolver: RegisteredAgentResolverPort;
  private readonly childRunInvoker: Pick<childRuns.ChildRunInvoker, 'invoke'>;
  private readonly lifecycle: RegisteredChildRunLifecyclePort;
  private readonly commandAgentRunLifecycle?: CommandAgentRunLifecyclePort;

  constructor(dependencies: {
    agentResolver: RegisteredAgentResolverPort;
    childRunInvoker: Pick<childRuns.ChildRunInvoker, 'invoke'>;
    lifecycle: RegisteredChildRunLifecyclePort;
    commandAgentRunLifecycle?: CommandAgentRunLifecyclePort;
  }) {
    this.agentResolver = dependencies.agentResolver;
    this.childRunInvoker = dependencies.childRunInvoker;
    this.lifecycle = dependencies.lifecycle;
    this.commandAgentRunLifecycle = dependencies.commandAgentRunLifecycle;
  }

  async invoke(params: RegisteredChildRunRequest): Promise<RegisteredChildRunResult> {
    const abortSignal = resolveAbortSignal(params);

    const { agentDefinition, agentConfig } = this.agentResolver.resolveByPromptKey(
      params.promptKey
    );
    const seedHistoryEvents = childRuns.pickChildRunSeedHistory({
      parentHistory: tools.readToolContextWorkingHistory(params.parentToolContext),
      historyPolicy: params.historyPolicy,
    });

    const traceBinding = createSubrunTracePublisher(params);
    const subrunId = traceBinding?.subrunId ?? params.tracePolicy?.subrunId ?? generateSubrunId();
    const childRunId = resolveChildRunId(params, subrunId);
    const parentRunId = resolveParentRunId(params);
    const parentToolCallId =
      params.tracePolicy?.parentToolCallId ?? params.parentToolContext.parentToolCallId;
    const modelId = resolveModelId(params, agentDefinition);
    const maxSteps = resolveMaxSteps(params, agentDefinition);
    const conversationId = resolveConversationId(params);
    const lifecycleRun = await this.lifecycle.start({
      runId: childRunId,
      parentRunId: requireParentRunIdForLifecycle(parentRunId, childRunId),
      conversationId: requireConversationIdForLifecycle(conversationId, childRunId),
      agentDefinition,
      request: {
        promptKey: params.promptKey,
        userMessage: params.userMessage,
        modelId,
        maxSteps,
        availableTools: agentConfig.availableTools,
      },
      abortSignal,
      metadata: {
        subrunId,
        traceSource: params.tracePolicy?.source,
        traceMetadata: params.tracePolicy?.metadata,
      },
      parentTracePublisher: traceBinding?.publisher,
    });
    let result: childRuns.ChildRunInvokeResult;
    let commandRunEndBarrier: CommandAgentRunEndBarrier | undefined;
    const lifecycle = this.lifecycle;
    const childAbortSignal = lifecycleRun.handle.signal;
    const endCommandAgentRun = async (): Promise<void> => {
      if (!this.commandAgentRunLifecycle) return;
      commandRunEndBarrier = await this.commandAgentRunLifecycle.endAgentRun({
        conversationId: CommandConversationIdSchema.parse(
          requireConversationIdForLifecycle(conversationId, childRunId),
        ),
        agentRunId: CommandAgentRunIdSchema.parse(childRunId),
      });
    };

    const recordSecondaryCleanupFailure = (cleanupError: unknown): void => {
      logger.error('Child Agent run 失败后的命令进程收口也失败', {
        conversationId,
        childRunId,
        cleanupError,
      });
    };

    try {
      try {
        await lifecycle.markRunning(lifecycleRun);

        result = await runWithLlmAuditContext(
          {
            ...(conversationId ? { conversationId } : {}),
            runId: childRunId,
            traceId: childRunId,
            subrunId,
            ...(parentToolCallId ? { parentToolCallId } : {}),
            source: params.tracePolicy?.source ?? 'child_run',
          },
          async () => {
            const childResult = await this.childRunInvoker.invoke({
              agentConfig,
              userMessage: params.userMessage,
              parentToolContext: toRegisteredChildRunParentContext(params.parentToolContext),
              conversationId,
              runId: childRunId,
              parentRunId,
              seedHistoryEvents,
              runtimeEventSink: lifecycleRun.runtimeEventSink,
              runtimeEventCommitPort: lifecycleRun.runtimeEventCommitPort,
              maxSteps,
              modelId,
              abortSignal: childAbortSignal,
            });
            if (Array.isArray(childResult.transcriptMessages)) {
              recordRunTranscript({
                transcriptMessages: childResult.transcriptMessages,
                toolset: childResult.toolset,
              });
            }
            return childResult;
          }
        );
      } catch (error) {
        try {
          await endCommandAgentRun();
        } catch (cleanupError: unknown) {
          recordSecondaryCleanupFailure(cleanupError);
        }
        if (error instanceof Error && error.name === 'AbortError') {
          await lifecycle.markCancelled(lifecycleRun, error);
        } else {
          await lifecycle.markFailed(lifecycleRun, error);
        }
        throw error;
      }

      if (result.success) {
        try {
          await endCommandAgentRun();
        } catch (cleanupError: unknown) {
          await lifecycle.markFailed(lifecycleRun, cleanupError, result.stepCount);
          throw cleanupError;
        }
      } else {
        try {
          await endCommandAgentRun();
        } catch (cleanupError: unknown) {
          recordSecondaryCleanupFailure(cleanupError);
        }
      }

      // Linnkit 将同步 child-run 的取消归一化为 Result；这里必须先于 success/failed 分流。
      if (result.cancelled) {
        await lifecycle.markCancelled(
          lifecycleRun,
          result.error ?? 'child-run cancelled',
          result.stepCount
        );
      } else if (result.success) {
        await lifecycle.markCompleted(lifecycleRun, result.stepCount);
      } else {
        await lifecycle.markFailed(
          lifecycleRun,
          result.error ?? 'child-run failed',
          result.stepCount
        );
      }
    } finally {
      lifecycle.close(lifecycleRun);
      // child lifecycle 已关闭，之后只剩结果投影，不再允许产生该 run 的 tool call。
      commandRunEndBarrier?.release();
    }

    return toRegisteredChildRunResult({
      promptKey: params.promptKey,
      subrunId,
      result,
    });
  }
}

export function createRegisteredChildRunInvoker(dependencies: {
  runtime: Pick<
    LinnyaAgentRuntimeScope,
    | 'supervisor'
    | 'eventStore'
    | 'nextEventStoreId'
    | 'costCollector'
    | 'auditPort'
    | 'llmInputMaterializer'
    | 'toolModelInputResolver'
  >;
  telemetryPort: telemetry.TelemetryPort;
  agentResolver?: RegisteredAgentResolverPort;
  childRunInvoker?: Pick<childRuns.ChildRunInvoker, 'invoke'>;
  commandRuntime:
    | { readonly kind: 'disabled' }
    | {
        readonly kind: 'enabled';
        readonly agentRunLifecycle: CommandAgentRunLifecyclePort;
      };
}): RegisteredChildRunInvokerPort {
  return new RegisteredChildRunInvoker({
    agentResolver: dependencies.agentResolver ?? createDefaultRegisteredAgentResolver(),
    childRunInvoker:
      dependencies.childRunInvoker ??
      createLinnyaChildRunInvoker({
        telemetryPort: dependencies.telemetryPort,
        auditPort: dependencies.runtime.auditPort,
        llmInputMaterializer: dependencies.runtime.llmInputMaterializer,
        modelInputResolver: dependencies.runtime.toolModelInputResolver,
      }),
    lifecycle: new LinnyaRegisteredChildRunLifecycle({
      supervisor: dependencies.runtime.supervisor,
      eventStore: dependencies.runtime.eventStore,
      nextEventStoreId: dependencies.runtime.nextEventStoreId,
      costCollector: dependencies.runtime.costCollector,
    }),
    commandAgentRunLifecycle: dependencies.commandRuntime.kind === 'enabled'
      ? dependencies.commandRuntime.agentRunLifecycle
      : undefined,
  });
}
