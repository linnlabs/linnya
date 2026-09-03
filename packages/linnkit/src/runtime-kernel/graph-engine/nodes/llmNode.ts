import { GraphNode, EngineState, NodeResult } from '../types';
import type { TickInput, TickOutput } from '../tick-pipeline/types';
import { Logger } from '../../../shared/logger';
import type { ExecutorLocalState } from '../types';
import { readGraphAgentLocal } from '../graphLocal';
import {
  initLlmNodeState,
  llmNodeReducer,
  buildLocalPatch,
  type LlmNodeAction,
} from './llmNode.state';
import { LlmNodeEventBridge, type TickEvent } from './llmNode.eventBridge';
import {
  createContextUsageSnapshotEvent,
  generateRuntimeEventId,
  parseRuntimeEvents,
  type RuntimeEvent,
} from '../../../contracts';
import { requireRuntimeIdentity } from '../tick-pipeline/helpers';

const logger = new Logger('LlmNode');

/**
 * LlmNode 只依赖"单步推理"能力，不直接依赖具体执行器实现。
 *
 * 中文备注：
 * - 这样节点本身只关注图节点职责，不负责组装 `LlmCaller` / `ToolRegistry`；
 * - 默认依赖装配放到工厂里，方便测试替换，也降低构造函数耦合。
 */
export interface LlmNodeReasoner {
  tick(input: TickInput, eventHandler?: (event: TickEvent) => void): Promise<TickOutput>;
}

export interface LlmNodeDependencies {
  reasoner: LlmNodeReasoner;
}

export class LlmNode implements GraphNode {
  id = 'llm';
  private readonly reasoner: LlmNodeReasoner;

  constructor(dependencies: LlmNodeDependencies) {
    this.reasoner = dependencies.reasoner;
  }

  async run(state: EngineState): Promise<NodeResult> {
    const local = state.local ?? {};
    logger.info('[LlmNode] 开始执行 LLM 节点', {
      localKeys: Object.keys(local),
    });

    const graphLocal = readGraphAgentLocal(state.local);
    const {
      conversationId,
      request,
      toolContext,
      summarizationCallbacks,
      runtimeEventSink,
      runtimeEventCommitPort,
      runtimeFailureFactSink,
      signal,
      history,
    } = graphLocal;
    logger.info('[LlmNode] 已加载历史事件', {
      historyCount: history.length,
      hasSummarizationCallbacks: Boolean(summarizationCallbacks),
    });

    if (!request) {
      logger.warn('Request object is missing, yielding.');
      return { kind: 'yield', events: [] };
    }
    const turnId = requireRuntimeIdentity(graphLocal.turnId, 'turnId');

    // ── 阶段/请求解析 ──

    const phase = graphLocal.executorLocal?.phase;
    const forceFinalAnswer = phase === 'force_final_answer';
    const forceTools = phase === 'force_tools';

    const finalStepForcedTools = graphLocal.executorLocal?.finalStepForcedTools;
    const forcedTools = Array.isArray(finalStepForcedTools)
      ? finalStepForcedTools.filter(toolName => typeof toolName === 'string' && toolName.length > 0)
      : [];

    const effectiveRequest = forceFinalAnswer
      ? { ...request, enableTools: false, availableTools: [] }
      : forceTools
        ? { ...request, enableTools: true, availableTools: forcedTools }
        : request;
    const executorLocal: ExecutorLocalState | undefined = graphLocal.executorLocal;

    // ── 状态 reducer ──

    let nodeState = initLlmNodeState({
      answerId: graphLocal.answerId,
      chunkSeq: graphLocal.chunkSeq,
    });
    const dispatch = (action: LlmNodeAction) => {
      nodeState = llmNodeReducer(nodeState, action);
    };

    // ── 事件桥（Phase 1.5-2b：SSE 分发与事件映射职责抽离） ──

    const bridge = new LlmNodeEventBridge({
      getState: () => nodeState,
      dispatch,
      runtimeEventSink,
      runtimeFailureFactSink,
      conversationId,
      turnId,
    });

    // ── 执行 tick ──

    let tickOutput: TickOutput;
    try {
      tickOutput = await this.reasoner.tick(
        {
          request: effectiveRequest,
          toolContext,
          stream: true,
          history,
          signal,
          forceFinalAnswer,
          executorLocal,
          summarizationCallbacks,
          runtimeEventCommitPort,
        },
        bridge.handle
      );
    } catch (error) {
      bridge.finalizePartialAnswer();
      throw error;
    }
    const { decision, executorLocalPatch, contextTrace, contextUsage } = tickOutput;

    // ── 决策 dispatch ──

    switch (decision.kind) {
      case 'tool_calls': {
        if (forceFinalAnswer) {
          dispatch({ type: 'TOOL_CALLS_REJECTED_BY_FORCE_FINAL' });
        } else {
          dispatch({ type: 'TOOL_CALLS_ACCEPTED', toolCalls: decision.toolCalls });
        }
        break;
      }
      case 'final_answer': {
        dispatch({ type: 'FINAL_ANSWER_DECISION', answer: decision.answer });
        break;
      }
      case 'wait_user': {
        dispatch({
          type: 'WAIT_USER_DECISION',
          spec: decision.pendingInteractionSpec,
          lastToolResult: decision.lastToolResult,
        });
        break;
      }
    }

    // ── 一次性回写 state.local ──

    const patch = buildLocalPatch(nodeState, {
      conversationId,
      turnId,
      history,
      executorLocal,
      executorLocalPatch,
      contextTrace,
      contextUsage,
    });
    state.local = { ...(state.local || {}), ...patch };

    /**
     * context usage 是本次成功 Provider attempt 的实时执行事实。它必须经过同一个 admission
     * sink 取得 run routing 与 execution_seq，但不进入 Graph history；否则 ephemeral 展示事件
     * 会随 checkpoint 膨胀，并在下一轮 Context 过滤前形成无意义的第二份运行状态。
     */
    const contextUsageEvent = contextUsage
      ? runtimeEventSink(
          createContextUsageSnapshotEvent(
            generateRuntimeEventId(),
            conversationId,
            turnId,
            contextUsage,
          ),
          'LlmNode.context_usage_snapshot',
        )
      : undefined;
    const combinedEvents = [
      ...nodeState.streamRuntimeEvents,
      ...(contextUsageEvent ? [contextUsageEvent] : []),
    ];

    logger.info('[LlmNode] 历史事件已更新', {
      previousCount: history.length,
      nextCount: parseRuntimeEvents(patch.history).length,
      streamedEventCount: nodeState.streamRuntimeEvents.length,
    });

    logger.info('[LlmNode] 执行器决策完成', {
      decisionKind: decision.kind,
      emittedEventCount: combinedEvents.length,
    });

    // ── 路由 ──

    switch (decision.kind) {
      case 'tool_calls': {
        if (forceFinalAnswer) {
          return { kind: 'yield', events: combinedEvents };
        }
        return { kind: 'route', nextNodeId: 'tool', events: combinedEvents };
      }
      case 'final_answer': {
        return { kind: 'yield', events: combinedEvents };
      }
      case 'wait_user': {
        return { kind: 'route', nextNodeId: 'wait_user', events: combinedEvents };
      }
      case 'yield': {
        return { kind: 'yield', events: combinedEvents };
      }
      case 'error': {
        // Logger 的载荷类型为 Record<string, unknown>，需将 Error 序列化为普通对象
        const { name, message, stack } = decision.error;
        logger.error('[LlmNode] Executor returned an error', { name, message, stack });
        return { kind: 'yield', events: combinedEvents };
      }
      default: {
        return { kind: 'yield', events: combinedEvents };
      }
    }
  }
}
