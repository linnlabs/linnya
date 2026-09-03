/**
 * @file src/agent/runtime-kernel/child-runs/childRunInvoker.ts
 * @description child-run 调用器
 */

import { GraphExecutor } from '../graph-engine/engine';
import { MemoryCheckpointer } from '../graph-engine/checkpointer/memoryCheckpointer';
import { ToolNode } from '../graph-engine/nodes/toolNode';
import { WaitUserNode } from '../graph-engine/nodes/waitUserNode';
import type { AgentInvocationRequest } from '../../ports';
import type {
  ObservationPreviewPort,
  ToolModelInputCapabilityValidatorPort,
  ToolRuntimePort,
} from '../tools/ports';
import type { ToolModelInputResolverPort } from '../tools/model-input';
import { noopAudit } from '../audit/noopAudit';
import { noopTelemetry } from '../telemetry/noopTelemetry';
import type { AuditPort } from '../../ports';
import type { TelemetryPort } from '../telemetry/telemetryPort';
import type { ChildRunParentContext } from './types';
import { generateRunId, generateRuntimeEventId, generateTurnId } from '../../contracts';
import { Logger } from '../../shared/logger';
import type { ModelResolverLike } from '../llm/modelResolver';
import type {
  GraphNode,
  RuntimeEventCommitPort,
  RuntimeEventSink,
} from '../graph-engine/types';
import type {
  AgentSpecContextPolicy,
  AgentSpecSystemReminderPolicy,
  RoutedRuntimeEvent,
  RuntimeEvent,
  RunId,
} from '../../contracts';
import { createChildRunToolContext, decideChildRunDepth } from './childToolContext';
import {
  appendUniqueEvents,
  buildChildRunTranscriptMessages,
  createChildRunUserInput,
  extractFinalAnswer,
  extractLastProgress,
  extractJudgeToolOutput,
} from './childRunEvents';
import { recoverChildRunEventsFromCheckpoint } from './checkpointRecovery';

const logger = new Logger('ChildRunInvoker');

export interface ChildRunAgentConfig {
  id: string;
  promptKey: string;
  availableTools?: readonly string[];
  modelPolicy?: { kind: 'fixed'; modelId: string };
  stepPolicy?: {
    kind: 'final_answer' | 'force_tools';
    lastStepsHintThreshold?: number;
    forcedTools?: readonly string[];
  };
  contextPolicy?: AgentSpecContextPolicy;
  systemReminderPolicy?: AgentSpecSystemReminderPolicy;
  systemPromptBuilder?: (request: AgentInvocationRequest) => string;
  judgeToolName?: string;
}

export interface ChildRunInvokeConfig {
  agentConfig: ChildRunAgentConfig;
  userMessage: string;
  parentToolContext: ChildRunParentContext;
  /**
   * child-run 的宿主会话归属，用于 RuntimeEvent / Audit / Telemetry。
   *
   * 未显式提供时继承父 ToolContext；两处都缺失属于 admission 错误。
   */
  conversationId?: string;
  runId?: RunId;
  parentRunId?: RunId;
  abortSignal?: AbortSignal;
  /** 由 child lifecycle 装配的唯一 RuntimeEvent admission 入口。 */
  runtimeEventSink: RuntimeEventSink;
  /** 由 child lifecycle 装配，用于在 fan-out 前持久化单个 durable fact。 */
  runtimeEventCommitPort?: RuntimeEventCommitPort;
  seedHistoryEvents?: RuntimeEvent[];
  maxSteps?: number;
  modelId?: string;
}

export interface ChildRunInvokeResult {
  runId?: RunId;
  parentRunId?: RunId;
  subrunId: string;
  success: boolean;
  cancelled?: boolean;
  judgeToolOutput?: string;
  finalAnswer?: string;
  lastProgress?: string;
  events: RoutedRuntimeEvent[];
  transcriptMessages?: unknown[];
  toolset?: {
    availableTools?: string[];
  };
  stepCount: number;
  error?: string;
}

export class ChildRunInvoker {
  private readonly modelResolver: Pick<ModelResolverLike, 'resolveModelId'>;
  private readonly createLlmNode: () => GraphNode;
  private readonly toolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'>;
  private readonly observationPreview: ObservationPreviewPort;
  private readonly modelInputCapabilityValidator?: ToolModelInputCapabilityValidatorPort;
  private readonly modelInputResolver?: ToolModelInputResolverPort;
  private readonly eventToMessageConverter: (events: RuntimeEvent[]) => unknown[];
  private readonly defaultJudgeToolName?: string;
  private readonly telemetryPort: TelemetryPort;
  private readonly auditPort: AuditPort;

  constructor(dependencies: {
    modelResolver: Pick<ModelResolverLike, 'resolveModelId'>;
    createLlmNode: () => GraphNode;
    toolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'>;
    observationPreview: ObservationPreviewPort;
    modelInputCapabilityValidator?: ToolModelInputCapabilityValidatorPort;
    modelInputResolver?: ToolModelInputResolverPort;
    eventToMessageConverter: (events: RuntimeEvent[]) => unknown[];
    defaultJudgeToolName?: string;
    telemetryPort?: TelemetryPort;
    auditPort?: AuditPort;
  }) {
    this.modelResolver = dependencies.modelResolver;
    this.createLlmNode = dependencies.createLlmNode;
    this.toolRuntime = dependencies.toolRuntime;
    this.observationPreview = dependencies.observationPreview;
    this.modelInputCapabilityValidator = dependencies.modelInputCapabilityValidator;
    this.modelInputResolver = dependencies.modelInputResolver;
    this.eventToMessageConverter = dependencies.eventToMessageConverter;
    this.defaultJudgeToolName = dependencies.defaultJudgeToolName;
    this.telemetryPort = dependencies.telemetryPort ?? noopTelemetry;
    this.auditPort = dependencies.auditPort ?? noopAudit;
  }

  async invoke(config: ChildRunInvokeConfig): Promise<ChildRunInvokeResult> {
    const {
      agentConfig,
      userMessage,
      parentToolContext,
      conversationId,
      runId,
      parentRunId,
      runtimeEventSink,
      runtimeEventCommitPort,
      seedHistoryEvents,
      maxSteps = 8,
      modelId,
      abortSignal,
    } = config;

    const childRunId = runId ?? generateRunId();
    const internalCheckpointKey = childRunId;
    const resolvedParentRunId = parentRunId ?? parentToolContext.runId;

    const depthDecision = decideChildRunDepth({ parentToolContext });
    if (!depthDecision.allowed) {
      logger.warn('child-run 深度超过上限，拒绝继续递归执行', {
        runId: childRunId,
        parentRunId: resolvedParentRunId,
        parentDepth: depthDecision.parentDepth,
        maxDepth: depthDecision.maxDepth,
      });
      return {
        success: false,
        runId: childRunId,
        parentRunId: resolvedParentRunId,
        subrunId: childRunId,
        events: [],
        stepCount: 0,
        error: depthDecision.error,
      };
    }

    if (abortSignal?.aborted || parentToolContext.abortSignal?.aborted) {
      logger.info('child-run 在任务接纳前已取消', {
        runId: childRunId,
        parentRunId: resolvedParentRunId,
      });
      return {
        success: false,
        runId: childRunId,
        parentRunId: resolvedParentRunId,
        subrunId: childRunId,
        cancelled: true,
        events: [],
        stepCount: 0,
        error: 'The user aborted a request.',
      };
    }

    const runtimeConversationId = resolveChildRunConversationId({
      explicitConversationId: conversationId,
      parentToolContext,
    });
    const turnId = generateTurnId();

    logger.info(`启动 child-run: ${agentConfig.id}`, {
      conversationId: runtimeConversationId,
      checkpointKey: internalCheckpointKey,
      maxSteps,
      userMessage: userMessage.slice(0, 100) + (userMessage.length > 100 ? '...' : ''),
    });

    const checkpointer = new MemoryCheckpointer();
    const graphExecutor = new GraphExecutor(checkpointer, { maxSteps });

    const llmNode = this.createLlmNode();
    const toolNode = new ToolNode({
      toolRuntime: this.toolRuntime,
      observationPreview: this.observationPreview,
      telemetryPort: this.telemetryPort,
      auditPort: this.auditPort,
      modelInputCapabilityValidator: this.modelInputCapabilityValidator,
      modelInputResolver: this.modelInputResolver,
    });
    const waitUserNode = new WaitUserNode({ auditPort: this.auditPort });

    graphExecutor.registerNode(llmNode);
    graphExecutor.registerNode(toolNode);
    graphExecutor.registerNode(waitUserNode);

    const childUserInput = createChildRunUserInput({
      id: generateRuntimeEventId(),
      conversationId: runtimeConversationId,
      turnId,
      content: userMessage,
    });
    const admittedChildUserInput = runtimeEventSink(childUserInput, 'ChildRunInvoker.user_input');

    const childModelId = resolveChildRunModelId({
      explicitModelId: modelId,
      agentConfig,
      resolveDefaultModelId: () => this.modelResolver.resolveModelId(),
    });
    const request: AgentInvocationRequest = {
      query: userMessage,
      currentUserEventId: admittedChildUserInput.id,
      promptKey: agentConfig.promptKey,
      model_id: childModelId,
      maxSteps,
      enableTools: true,
      availableTools: agentConfig.availableTools ? [...agentConfig.availableTools] : undefined,
      ...(parentToolContext.childRunContextInjections
        ? { fences: [...parentToolContext.childRunContextInjections] }
        : {}),
    };

    const systemPrompt = agentConfig.systemPromptBuilder
      ? agentConfig.systemPromptBuilder(request)
      : '';

    const stepPolicy = agentConfig.stepPolicy;
    const executorLocalPolicy: Record<string, unknown> = {};
    if (agentConfig.modelPolicy?.kind === 'fixed' && !modelId) {
      executorLocalPolicy.lockRequestedModelId = true;
    }
    if (stepPolicy) {
      const kind = stepPolicy.kind;
      if (kind === 'final_answer' || kind === 'force_tools') {
        executorLocalPolicy.finalStepPolicy = kind;
      }
      const threshold = stepPolicy.lastStepsHintThreshold;
      if (typeof threshold === 'number' && Number.isFinite(threshold)) {
        executorLocalPolicy.lastStepsHintThreshold = threshold;
      }
      const forcedTools = stepPolicy.forcedTools;
      if (Array.isArray(forcedTools)) {
        const names = forcedTools.filter((x): x is string => typeof x === 'string' && x.length > 0);
        const allowed = Array.isArray(request.availableTools)
          ? new Set(
              request.availableTools.filter(
                (x): x is string => typeof x === 'string' && x.length > 0
              )
            )
          : undefined;
        const finalNames = allowed ? names.filter(n => allowed.has(n)) : names;
        if (finalNames.length > 0) {
          executorLocalPolicy.finalStepForcedTools = finalNames;
        }
      }
    }

    const systemReminderPolicy = resolveChildRunSystemReminderPolicy(agentConfig);
    if (systemReminderPolicy) {
      executorLocalPolicy.systemReminderPolicy = systemReminderPolicy;
    }

    const seedHistory: RuntimeEvent[] = [
      ...(Array.isArray(seedHistoryEvents) ? seedHistoryEvents : []),
      admittedChildUserInput,
    ];

    const childToolContext = createChildRunToolContext({
      parentToolContext,
      conversationId: runtimeConversationId,
      turnId,
      runId: childRunId,
      parentRunId: resolvedParentRunId,
      userQuery: userMessage,
      modelId: childModelId,
      seedHistory,
      abortSignal,
    });

    const initialLocal: Record<string, unknown> = {
      request,
      history: seedHistory,
      conversationId: runtimeConversationId,
      turnId,
      toolContext: childToolContext,
      ...(abortSignal ? { signal: abortSignal } : {}),
      ...(Object.keys(executorLocalPolicy).length > 0
        ? { executorLocal: executorLocalPolicy }
        : {}),
      runtimeEventSink,
      ...(runtimeEventCommitPort ? { runtimeEventCommitPort } : {}),
      systemPrompt,
    };

    const allEvents: RoutedRuntimeEvent[] = [];
    let stepCount = 0;
    let finalAnswer: string | undefined;
    let lastProgress: string | undefined;
    let judgeToolOutput: string | undefined;
    let transcriptMessages: unknown[] | undefined;
    const toolset = Array.isArray(request.availableTools)
      ? { availableTools: request.availableTools }
      : undefined;
    let error: string | undefined;
    let cancelled = false;

    try {
      const result = await graphExecutor.startSession(internalCheckpointKey, initialLocal, 'llm');
      appendUniqueEvents(allEvents, result.events);
      stepCount = result.stepCount;
      if (
        result.checkpoint.nodeId === 'wait_user' ||
        result.events.some(event => event.type === 'requires_user_interaction')
      ) {
        throw new Error(
          'Interactive tools are not supported in synchronous child runs; delegate the interaction to the foreground run'
        );
      }

      judgeToolOutput = extractJudgeToolOutput(
        allEvents,
        agentConfig.judgeToolName ?? this.defaultJudgeToolName
      );
      finalAnswer = extractFinalAnswer(allEvents);
      lastProgress = finalAnswer ? undefined : extractLastProgress(allEvents);

      logger.info('child-run 执行完成', {
        stepCount,
        eventCount: allEvents.length,
        hasFinalAnswer: !!finalAnswer,
        hasJudgeToolOutput: !!judgeToolOutput,
      });

      transcriptMessages = buildChildRunTranscriptMessages({
        systemPrompt,
        userMessage,
        events: allEvents,
        eventToMessageConverter: this.eventToMessageConverter,
      });
    } catch (err) {
      const recoveredEvents = await recoverChildRunEventsFromCheckpoint({
        checkpointer,
        checkpointKey: internalCheckpointKey,
        childConversationId: runtimeConversationId,
        seedHistory,
      });
      appendUniqueEvents(allEvents, recoveredEvents);

      judgeToolOutput = extractJudgeToolOutput(
        allEvents,
        agentConfig.judgeToolName ?? this.defaultJudgeToolName
      );
      finalAnswer = extractFinalAnswer(allEvents);
      lastProgress = finalAnswer ? undefined : extractLastProgress(allEvents);
      // provider 可能把同一次受控取消包装成普通 Error；当前执行链自己的
      // AbortSignal 才是 lifecycle 权威，错误名称只用于兼容标准 AbortError。
      cancelled = abortSignal?.aborted === true || isAbortError(err);
      error = err instanceof Error ? err.message : String(err);
      if (cancelled) {
        logger.info('child-run 执行取消', {
          runId: childRunId,
          parentRunId: resolvedParentRunId,
          message: error,
        });
      } else {
        logger.error(
          'child-run 执行失败:',
          err instanceof Error
            ? {
                name: err.name,
                message: err.message,
                stack: err.stack,
              }
            : { error: String(err) }
        );
      }
    }

    transcriptMessages ??= buildChildRunTranscriptMessages({
      systemPrompt,
      userMessage,
      events: allEvents,
      eventToMessageConverter: this.eventToMessageConverter,
    });

    await checkpointer.clear(internalCheckpointKey);

    return {
      success: !error && !cancelled,
      runId: childRunId,
      parentRunId: resolvedParentRunId,
      subrunId: childRunId,
      cancelled: cancelled || undefined,
      judgeToolOutput,
      finalAnswer,
      lastProgress,
      events: allEvents,
      transcriptMessages,
      toolset,
      stepCount,
      error,
    };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveChildRunConversationId(params: {
  explicitConversationId?: string;
  parentToolContext: ChildRunParentContext;
}): string {
  const conversationId =
    readNonEmptyString(params.explicitConversationId) ??
    readNonEmptyString(params.parentToolContext.conversationId);
  if (!conversationId) {
    throw new Error(
      'ChildRunInvoker requires conversationId from admission or parent ToolContext.'
    );
  }
  return conversationId;
}

function resolveChildRunModelId(params: {
  explicitModelId?: string;
  agentConfig: ChildRunAgentConfig;
  resolveDefaultModelId: () => string;
}): string {
  const explicitModelId = readNonEmptyString(params.explicitModelId);
  if (explicitModelId) {
    return explicitModelId;
  }

  const modelPolicy = params.agentConfig.modelPolicy;
  if (modelPolicy?.kind === 'fixed') {
    return modelPolicy.modelId;
  }

  return params.resolveDefaultModelId();
}

function resolveChildRunSystemReminderPolicy(
  agentConfig: ChildRunAgentConfig
): AgentSpecSystemReminderPolicy | undefined {
  const configured = agentConfig.systemReminderPolicy ?? agentConfig.contextPolicy?.systemReminder;
  const threshold = agentConfig.stepPolicy?.lastStepsHintThreshold;
  const nextPolicy: AgentSpecSystemReminderPolicy = {
    ...(configured ?? {}),
  };

  if (
    typeof threshold === 'number' &&
    Number.isFinite(threshold) &&
    nextPolicy.thresholds?.lastStepsHintThreshold === undefined
  ) {
    nextPolicy.thresholds = {
      ...(nextPolicy.thresholds ?? {}),
      lastStepsHintThreshold: threshold,
    };
  }

  return Object.keys(nextPolicy).length > 0 ? nextPolicy : undefined;
}
