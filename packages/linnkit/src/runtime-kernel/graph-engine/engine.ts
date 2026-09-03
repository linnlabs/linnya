import { Logger } from '../../shared/logger';
import { ENGINE_ERROR_CODES } from '../../shared/errorClassifier';
import { createEngineErrorEvent } from '../../shared/engineErrorEvent';
import { generateRuntimeEventId } from '../../contracts';
import { noopTelemetry } from '../telemetry/noopTelemetry';
import type {
  RunLifecycleTerminalReason,
  TelemetryPort,
} from '../telemetry/telemetryPort';
import type { Checkpointer } from './checkpointer/base';
import {
  ENGINE_STATE_SCHEMA_VERSION,
  type EngineState,
  type ExecutorLocalState,
  type GraphNode,
} from './types';
import { DEFAULT_MAX_STEPS, type RoutedRuntimeEvent } from '../../contracts';
import { sanitizeCheckpointLocal } from './functions/engineStateSnapshot';
import { prepareGraphStep } from './functions/graphStepPreparation';
import { resolveGraphStepResult } from './functions/graphStepResult';
import { runGraphNodeWithTelemetry } from './orchestration/runGraphNodeWithTelemetry';
import { runWithLifecycleTelemetry } from './orchestration/runWithLifecycleTelemetry';
import { requireRuntimeEventSink } from './graphLocal';
import { requireRuntimeIdentity } from './tick-pipeline/helpers';

const logger = new Logger('GraphExecutor');

type GraphRunResult = { events: RoutedRuntimeEvent[]; checkpoint: EngineState; stepCount: number };

type SuccessfulRunTerminalReason = Extract<
  RunLifecycleTerminalReason,
  'completed' | 'awaiting_user' | 'step_budget_forced_completion' | 'step_budget_exhausted'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isExecutorLocalState(value: unknown): value is ExecutorLocalState {
  return isRecord(value) && typeof value.stepCount === 'number';
}

function resolveSuccessfulRunTerminalReason(result: GraphRunResult): SuccessfulRunTerminalReason {
  if (result.checkpoint.nodeId === 'wait_user') return 'awaiting_user';
  if (result.events.some(
    event => event.type === 'error'
      && event.error_code === ENGINE_ERROR_CODES.ENGINE_BUDGET_EXHAUSTED,
  )) {
    return 'step_budget_exhausted';
  }
  if (result.checkpoint.local?.executorLocal?.phase === 'force_final_answer') {
    return 'step_budget_forced_completion';
  }
  return 'completed';
}

/**
 * wait-user 恢复会重新装配本 execution 的策略（如收尾策略、提醒规则），
 * 但上下文压缩计数属于同一逻辑 run 的持久执行事实，不能被新策略覆盖。
 *
 * 不合并旧 executorLocal 的其余字段：它们要么由本轮 step preparation 重算，
 * 要么是本 execution 的策略；携带它们会把过期策略带进恢复后的 transport。
 */
function mergeResumeSessionLocal(
  persistedLocal: EngineState['local'],
  localPatch: Record<string, unknown>,
): NonNullable<EngineState['local']> {
  const mergedLocal: NonNullable<EngineState['local']> = {
    ...(persistedLocal ?? {}),
    ...localPatch,
  };
  const persistedCompaction = persistedLocal?.executorLocal?.contextCompaction;
  const nextExecutorLocal = localPatch.executorLocal;

  if (!persistedCompaction || !isExecutorLocalState(nextExecutorLocal)) {
    return mergedLocal;
  }

  return {
    ...mergedLocal,
    executorLocal: {
      ...nextExecutorLocal,
      contextCompaction: { ...persistedCompaction },
    },
  };
}

export interface GraphResumeSessionInput {
  expectedRevision: number;
  localPatch: Record<string, unknown>;
  nodeId?: string;
  expectedNodeId?: string;
  /** 本次 session execution 使用的步数预算；未传时沿用已持久化预算或 executor 默认值。 */
  maxSteps?: number;
}

export interface GraphSessionExecutionOptions {
  /** 当前 session execution 的步数预算；用于共享 GraphExecutor 上的不同 Agent run。 */
  maxSteps?: number;
}

export interface GraphExecutorConfig {
  maxSteps?: number;
  /**
   * 可选：宿主提供的 TelemetryPort 实现。
   * 不传时使用 noopTelemetry（observability 默认关闭，零业务影响）。
   */
  telemetryPort?: TelemetryPort;
}

export class GraphExecutor {
  private nodes: Map<string, GraphNode> = new Map();
  private ephemeralLocals: Map<string, Record<string, unknown>> = new Map();
  private checkpointQueues: Map<string, Promise<void>> = new Map();
  private readonly config: Required<Pick<GraphExecutorConfig, 'maxSteps'>>;
  private readonly telemetryPort: TelemetryPort;

  constructor(
    private readonly checkpointer: Checkpointer,
    config: GraphExecutorConfig = {}
  ) {
    this.config = {
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
    };
    this.telemetryPort = config.telemetryPort ?? noopTelemetry;
  }

  registerNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  async peekCheckpoint(checkpointKey: string): Promise<EngineState | null> {
    return await this.checkpointer.load(checkpointKey);
  }

  private sanitize(state: EngineState): EngineState {
    return {
      nodeId: state.nodeId,
      revision: state.revision ?? 0,
      schemaVersion: state.schemaVersion ?? ENGINE_STATE_SCHEMA_VERSION,
      local: sanitizeCheckpointLocal(state.local),
    };
  }

  /**
   * 原子启动一次 Graph session。
   *
   * 同一个 checkpointKey 的“创建初态 + 执行到 yield”共享同一临界区，调用方不再
   * 需要组合 prime/runUntilYield，也就不会在两步之间被另一个 run 覆盖。
   */
  async startSession(
    checkpointKey: string,
    local: Record<string, unknown>,
    nodeId: string = 'user',
    options: GraphSessionExecutionOptions = {},
  ): Promise<GraphRunResult> {
    return this.runWithCheckpointQueue(checkpointKey, async () => {
      const existing = await this.checkpointer.load(checkpointKey);
      if (existing) {
        throw new Error(`Graph checkpoint already exists: ${checkpointKey}`);
      }
      this.ephemeralLocals.set(checkpointKey, { ...local });
      await this.checkpointer.save(checkpointKey, {
        nodeId,
        revision: 1,
        schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
        local: sanitizeCheckpointLocal(local),
      });
      return this.runUntilYieldQueued(
        checkpointKey,
        options.maxSteps ?? this.config.maxSteps,
      );
    });
  }

  /** 同一个 run 从已持久化 wait_user checkpoint 继续执行。 */
  async resumeSession(
    checkpointKey: string,
    input: GraphResumeSessionInput,
  ): Promise<GraphRunResult> {
    return this.runWithCheckpointQueue(checkpointKey, async () => {
      const current = await this.checkpointer.load(checkpointKey);
      if (!current) {
        throw new Error(`Graph checkpoint does not exist: ${checkpointKey}`);
      }
      const currentRevision = current.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new Error(
          `Graph checkpoint revision conflict: expected=${input.expectedRevision}, actual=${currentRevision}`,
        );
      }
      const expectedNodeId = input.expectedNodeId ?? 'wait_user';
      if (current.nodeId !== expectedNodeId) {
        throw new Error(
          `Graph checkpoint is not resumable: expected node=${expectedNodeId}, actual=${current.nodeId}`,
        );
      }

      const resumedLocal = mergeResumeSessionLocal(current.local, input.localPatch);
      // 同一份合并结果同时进入 durable checkpoint 与本 execution 的 ephemeral local。
      // 否则 runUntilYieldInternal 的 ephemeral overlay 会再次抹掉持久压缩进度。
      this.ephemeralLocals.set(checkpointKey, resumedLocal);
      await this.checkpointer.save(checkpointKey, {
        ...current,
        nodeId: input.nodeId ?? 'llm',
        revision: currentRevision + 1,
        local: sanitizeCheckpointLocal(resumedLocal),
      });
      const persistedMaxSteps = current.local?.executorLocal?.maxSteps;
      return this.runUntilYieldQueued(
        checkpointKey,
        input.maxSteps ?? persistedMaxSteps ?? this.config.maxSteps,
      );
    });
  }

  async clearCheckpoint(checkpointKey: string): Promise<void> {
    await this.runWithCheckpointQueue(checkpointKey, async () => {
      this.ephemeralLocals.delete(checkpointKey);
      await this.checkpointer.clear(checkpointKey);
    });
  }

  async prime(checkpointKey: string, local: Record<string, unknown>, nodeId: string = 'user'): Promise<void> {
    this.ephemeralLocals.set(checkpointKey, { ...(local || {}) });
    const state: EngineState = {
      nodeId,
      revision: 1,
      schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
      local: sanitizeCheckpointLocal(local),
    };
    await this.checkpointer.save(checkpointKey, state);
  }

  async setNode(checkpointKey: string, nodeId: string, localPatch?: Record<string, unknown>): Promise<void> {
    const current = (await this.checkpointer.load(checkpointKey)) || {
      nodeId: 'user',
      revision: 0,
      schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
      local: {},
    };
    const mergedLocal = { ...(current.local || {}), ...(localPatch || {}) };
    const next: EngineState = {
      nodeId,
      revision: (current.revision ?? 0) + 1,
      schemaVersion: current.schemaVersion ?? ENGINE_STATE_SCHEMA_VERSION,
      local: sanitizeCheckpointLocal(mergedLocal),
    };
    await this.checkpointer.save(checkpointKey, next);
  }

  async runUntilYield(
    checkpointKey: string,
    options: GraphSessionExecutionOptions = {},
  ): Promise<GraphRunResult> {
    return this.runWithCheckpointQueue(
      checkpointKey,
      () => this.runUntilYieldQueued(
        checkpointKey,
        options.maxSteps ?? this.config.maxSteps,
      ),
    );
  }

  private async runWithCheckpointQueue<T>(
    checkpointKey: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.checkpointQueues.get(checkpointKey) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current, () => current);
    this.checkpointQueues.set(checkpointKey, tail);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.checkpointQueues.get(checkpointKey) === tail) {
        this.checkpointQueues.delete(checkpointKey);
      }
    }
  }

  private async runUntilYieldQueued(
    checkpointKey: string,
    maxSteps: number,
  ): Promise<GraphRunResult> {
    return await runWithLifecycleTelemetry({
      checkpointKey,
      maxSteps,
      telemetryPort: this.telemetryPort,
      loadInitialState: () => this.loadInitialState(checkpointKey),
      run: async (initialState, reportStepsUsed) => {
        const result = await this.runUntilYieldInternal(
          checkpointKey,
          initialState,
          reportStepsUsed,
          maxSteps,
        );
        return {
          result,
          finalState: result.checkpoint,
          terminalReason: resolveSuccessfulRunTerminalReason(result),
        };
      },
    });
  }

  private async loadInitialState(checkpointKey: string): Promise<EngineState> {
    return (await this.checkpointer.load(checkpointKey)) || {
      nodeId: 'user',
      schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
      local: {},
    };
  }

  private async saveCheckpoint(checkpointKey: string, state: EngineState): Promise<EngineState> {
    const checkpoint = this.sanitize({
      ...state,
      revision: (state.revision ?? 0) + 1,
    });
    await this.checkpointer.save(checkpointKey, checkpoint);
    return checkpoint;
  }

  private async saveCheckpointAndBuildResult(
    checkpointKey: string,
    state: EngineState,
    events: RoutedRuntimeEvent[],
    stepCount: number,
  ): Promise<GraphRunResult> {
    const checkpoint = await this.saveCheckpoint(checkpointKey, state);
    return { events, checkpoint, stepCount };
  }

  private async runUntilYieldInternal(
    checkpointKey: string,
    initialState: EngineState,
    reportStepsUsed: (stepsUsed: number) => void,
    maxSteps: number,
  ): Promise<GraphRunResult> {
    let state: EngineState = initialState;
    const ephemeral = this.ephemeralLocals.get(checkpointKey) || {};
    state = {
      ...state,
      schemaVersion: state.schemaVersion ?? ENGINE_STATE_SCHEMA_VERSION,
      local: { ...(state.local || {}), ...ephemeral },
    };

    const isAbortSignal = (v: unknown): v is AbortSignal => {
      return v !== null && typeof v === 'object' && 'aborted' in v;
    };
    const throwAbortError = (): never => {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    };

    let stepCount = 0;
    let allEvents: RoutedRuntimeEvent[] = [];
    logger.info('[GraphExecutor] 开始推理循环', {
      maxSteps,
    });

    while (stepCount < maxSteps) {
      stepCount += 1;
      reportStepsUsed(stepCount);

      const signalRaw = (state.local as Record<string, unknown> | undefined)?.signal;
      if (isAbortSignal(signalRaw) && signalRaw.aborted) {
        logger.warn('[GraphExecutor] 收到 AbortSignal，立即停止推理循环');
        this.ephemeralLocals.delete(checkpointKey);
        throwAbortError();
      }

      const stepPreparation = prepareGraphStep({
        state,
        maxSteps,
        stepCount,
      });
      state = stepPreparation.state;

      const node = this.nodes.get(state.nodeId);
      if (!node) {
        logger.info('[GraphExecutor] 推理完成，无可执行节点', {
          maxSteps,
          stepCount,
        });
        const result = await this.saveCheckpointAndBuildResult(checkpointKey, state, allEvents, stepCount);
        this.ephemeralLocals.delete(checkpointKey);
        return result;
      }

      logger.info('[GraphExecutor] 节点切换', {
        maxSteps,
        stepCount,
        nodeId: state.nodeId,
      });

      const result = await runGraphNodeWithTelemetry({
        node,
        state,
        checkpointKey,
        telemetryPort: this.telemetryPort,
      });

      const stepResolution = resolveGraphStepResult({
        state,
        result,
      });

      if (stepResolution.events.length > 0) {
        logger.info('[GraphExecutor] 节点产生事件', {
          nodeId: state.nodeId,
          eventCount: stepResolution.events.length,
          events: stepResolution.events.map((event) => `${event.type}(${event.timestamp})`),
        });
        allEvents.push(...stepResolution.events);
      }

      state = stepResolution.state;

      if (stepResolution.action.kind === 'route') {
        logger.info('[GraphExecutor] 路由切换', {
          fromNodeId: stepResolution.action.fromNodeId,
          nextNodeId: stepResolution.action.nextNodeId,
        });
        await this.saveCheckpoint(checkpointKey, state);
        continue;
      }

      if (stepResolution.action.kind === 'yield') {
        logger.info('[GraphExecutor] 推理暂停，等待外部输入', {
          maxSteps,
          stepCount,
        });
        return await this.saveCheckpointAndBuildResult(checkpointKey, state, allEvents, stepCount);
      }

      logger.info('[GraphExecutor] 推理暂停，等待用户交互', {
        maxSteps,
        stepCount,
      });
      return await this.saveCheckpointAndBuildResult(checkpointKey, state, allEvents, stepCount);
    }

    logger.warn('[GraphExecutor] 达到步数上限，强制结束', {
      maxSteps,
      stepCount,
    });
    const conversationId = requireRuntimeIdentity(state.local?.conversationId, 'conversationId');
    const turnId = requireRuntimeIdentity(state.local?.turnId, 'turnId');
    allEvents.push(requireRuntimeEventSink(state.local)(createEngineErrorEvent({
      id: generateRuntimeEventId(),
      conversationId,
      turnId,
      errorCode: ENGINE_ERROR_CODES.ENGINE_BUDGET_EXHAUSTED,
      error: `Maximum step budget (${maxSteps}) exhausted after ${stepCount} steps`,
      details: {
        maxSteps,
        stepCount,
      },
      retryable: false,
    }), 'GraphExecutor.engine_budget_exhausted'));
    const result = await this.saveCheckpointAndBuildResult(checkpointKey, state, allEvents, stepCount);
    this.ephemeralLocals.delete(checkpointKey);
    return result;
  }
}
