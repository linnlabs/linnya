import type { PromptKey } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import type { RunId } from '@linnlabs/linnkit/contracts';
import { childRunTrace, execution, graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { SubRunTracePublisher } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { runnableDefinitionToAgentSpec } from 'src/app-hosts/linnya/adapters/runtime/agentDefinitionToAgentSpec';

type RunHandle = runSupervisor.RunHandle<AgentInvocationRequest>;

export interface LinnyaRegisteredChildRunLifecycleDependencies {
  supervisor: runSupervisor.RunSupervisor<AgentInvocationRequest>;
  eventStore: graph.EventStore;
  nextEventStoreId: () => string;
  costCollector: runSupervisor.RunCostCollector;
}

export interface RegisteredChildRunLifecycleRequest {
  promptKey: PromptKey;
  userMessage: string;
  modelId?: string;
  maxSteps?: number;
  availableTools?: readonly string[];
}

export interface RegisteredChildRunLifecycleStartParams {
  runId: RunId;
  parentRunId?: RunId;
  conversationId: string;
  agentDefinition: AgentDefinition;
  request: RegisteredChildRunLifecycleRequest;
  abortSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
  parentTracePublisher?: SubRunTracePublisher;
}

export interface RegisteredChildRunLifecycleStartResult {
  handle: RunHandle;
  eventBus: execution.EventBus;
  runtimeEventSink: graph.RuntimeEventSink;
  runtimeEventCommitPort: graph.RuntimeEventCommitPort;
  persistence: execution.EventBusEventPersistence;
  parentTraceProjection?: childRunTrace.ChildRunParentTraceProjection;
}

export interface RegisteredChildRunLifecyclePort {
  start(
    params: RegisteredChildRunLifecycleStartParams
  ): Promise<RegisteredChildRunLifecycleStartResult>;
  markRunning(result: RegisteredChildRunLifecycleStartResult): Promise<void>;
  markCompleted(result: RegisteredChildRunLifecycleStartResult, stepCount: number): Promise<void>;
  markFailed(
    result: RegisteredChildRunLifecycleStartResult,
    error: unknown,
    stepCount?: number
  ): Promise<void>;
  markCancelled(
    result: RegisteredChildRunLifecycleStartResult,
    error: unknown,
    stepCount?: number
  ): Promise<void>;
  close(result: RegisteredChildRunLifecycleStartResult): void;
}

function toAgentInvocationRequest(
  params: RegisteredChildRunLifecycleRequest
): AgentInvocationRequest {
  return {
    query: params.userMessage,
    promptKey: params.promptKey,
    ...(typeof params.modelId === 'string' ? { model_id: params.modelId } : {}),
    ...(typeof params.maxSteps === 'number' ? { maxSteps: params.maxSteps } : {}),
    ...(Array.isArray(params.availableTools) ? { availableTools: [...params.availableTools] } : {}),
    enableTools: true,
  };
}

function toFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Linnya 默认 registered child-run 生命周期适配器。
 *
 * 中文备注：
 * - 这里不是 linnkit 通用层的新生命周期抽象，而是 Linnya SQLite 宿主的接入编排；
 * - 子 Agent 的 LLM tick 会通过 EventStore-backed AuditPort 写审计事件；
 * - 因此执行前必须先把 child run 注册进 RunRegistryStore，保证 SQLite `runs.id`
 *   与 child-run 的 runId/subrunId 是同一个事实。
 */
export class LinnyaRegisteredChildRunLifecycle implements RegisteredChildRunLifecyclePort {
  constructor(private readonly dependencies: LinnyaRegisteredChildRunLifecycleDependencies) {}

  async start(
    params: RegisteredChildRunLifecycleStartParams
  ): Promise<RegisteredChildRunLifecycleStartResult> {
    const sequencer = new execution.EventSequencer(params.conversationId);
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const runtimeEventPublisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: params.runId,
      ...(params.parentRunId ? { parent_run_id: params.parentRunId } : {}),
      lane: 'child',
      visibility: 'parent-trace',
    });
    let handle: RunHandle;
    const supervisor = this.dependencies.supervisor;
    const eventStore = this.dependencies.eventStore;
    const persistence = new execution.EventBusEventPersistence({
      eventBus,
      eventStore,
      nextEventStoreId: this.dependencies.nextEventStoreId,
    });
    persistence.connect();
    const parentTraceProjection = params.parentTracePublisher
      ? new childRunTrace.ChildRunParentTraceProjection({
          childEventBus: eventBus,
          parentTracePublisher: params.parentTracePublisher,
        })
      : undefined;
    parentTraceProjection?.connect();
    const costCollector = this.dependencies.costCollector;
    try {
      handle = await supervisor.registerRun({
        runId: params.runId,
        parentRunId: params.parentRunId,
        parentSignal: params.abortSignal,
        conversationId: params.conversationId,
        agentSpec: runnableDefinitionToAgentSpec(params.agentDefinition),
        request: toAgentInvocationRequest(params.request),
        eventBus,
        eventStore,
        costCollector,
        metadata: {
          source: 'registered-child-run',
          promptKey: params.request.promptKey,
          ...(params.metadata ?? {}),
        },
      });
    } catch (error) {
      eventBus.close();
      throw error;
    }

    return {
      handle,
      eventBus,
      runtimeEventSink: (event, source) => runtimeEventPublisher.publish(event, source),
      runtimeEventCommitPort: async (event) => {
        const routed = runtimeEventPublisher.route(event);
        await persistence.commitBeforePublish(routed);
      },
      persistence,
      ...(parentTraceProjection ? { parentTraceProjection } : {}),
    };
  }

  async markRunning(result: RegisteredChildRunLifecycleStartResult): Promise<void> {
    await result.handle.markRunning({ currentNode: 'llm' });
  }

  async markCompleted(
    result: RegisteredChildRunLifecycleStartResult,
    stepCount: number
  ): Promise<void> {
    try {
      await this.drain(result);
    } catch (error) {
      await this.markFactPipelineFailed(result.handle, error, stepCount);
      throw error;
    }
    await result.handle.markCompleted({
      currentNode: 'completed',
      iterationsUsed: stepCount,
    });
  }

  async markFailed(
    result: RegisteredChildRunLifecycleStartResult,
    error: unknown,
    stepCount?: number
  ): Promise<void> {
    try {
      await this.drain(result);
    } catch (pipelineError) {
      await this.markFactPipelineFailed(result.handle, pipelineError, stepCount);
      throw pipelineError;
    }
    await result.handle.markFailed(
      {
        errorCode: 'CHILD_RUN_FAILED',
        message: toFailureMessage(error),
        recoverable: false,
      },
      {
        currentNode: 'failed',
        ...(typeof stepCount === 'number' ? { iterationsUsed: stepCount } : {}),
      }
    );
  }

  async markCancelled(
    result: RegisteredChildRunLifecycleStartResult,
    error: unknown,
    stepCount?: number
  ): Promise<void> {
    try {
      await this.drain(result);
    } catch (pipelineError) {
      await this.markFactPipelineFailed(result.handle, pipelineError, stepCount);
      throw pipelineError;
    }
    await result.handle.cancel(
      {
        reason: toFailureMessage(error),
        forceCleanup: false,
      },
      {
        currentNode: 'cancelled',
        ...(typeof stepCount === 'number' ? { iterationsUsed: stepCount } : {}),
      }
    );
  }

  close(result: RegisteredChildRunLifecycleStartResult): void {
    result.eventBus.close();
  }

  private async drain(result: RegisteredChildRunLifecycleStartResult): Promise<void> {
    await result.persistence.drain();
    await result.parentTraceProjection?.drain();
  }

  private async markFactPipelineFailed(
    handle: RunHandle,
    error: unknown,
    stepCount?: number
  ): Promise<void> {
    await handle.markFailed(
      {
        errorCode: 'CHILD_RUN_FACT_PIPELINE_FAILED',
        message: toFailureMessage(error),
        recoverable: false,
      },
      {
        currentNode: 'failed',
        ...(typeof stepCount === 'number' ? { iterationsUsed: stepCount } : {}),
      }
    );
  }
}
