import type { ConversationNextRequest, RuntimeEvent } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { Logger } from 'src/shared/logger';
import { HistoryBuilder } from 'src/app-hosts/linnya/adapters/flow/flow.history-builder.service';
import { HistoryHandlerService } from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import type { FlowExecutionResult } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import type { FlowIncomingEventBatch } from './incoming-events/definitions/flowIncomingEventBatch';
import { FlowIncomingEventPreparer } from './incoming-events/orchestration/prepareFlowIncomingEventBatch';

const logger = new Logger('FlowRunPreparationService');

export interface PreparedFlowRunInput {
  agentInvokeReq: AgentInvokeRequest;
  contextHistoryEvents: RuntimeEvent[];
  effectiveOptions: ConversationNextRequest['options'];
  incomingBatch: FlowIncomingEventBatch;
}

function selectHistoryBeforeReplacement(
  request: ConversationNextRequest,
  history: readonly RuntimeEvent[],
): RuntimeEvent[] {
  const targetId = request.options?.truncateFromMessageId;
  if (!targetId) return [...history];

  const targetIndex = history.findIndex(event => event.id === targetId);
  const target = targetIndex >= 0 ? history[targetIndex] : undefined;
  if (!target || target.type !== 'user_input') {
    throw new Error(`[FlowRunPreparationService] replacement target ${targetId} is not a user_input fact`);
  }
  return history.slice(0, targetIndex);
}

export type FlowRunPreparationResult =
  | {
      kind: 'persist_only';
      result: FlowExecutionResult;
      incomingBatch: FlowIncomingEventBatch;
    }
  | {
      kind: 'execute';
      prepared: PreparedFlowRunInput;
    };

/**
 * Flow host application layer 的 pre-run policy service。
 *
 * 中文备注：
 * - 这里拥有 run 之前的应用级策略：history read、persist_only、history isolation、
 *   request build、mode resolve；
 * - 它不拥有 EventBus/SSE/persistence host session，也不拥有 GraphExecutor/runtime 协议。
 */
export class FlowRunPreparationService {
  constructor(
    private readonly historyHandler: HistoryHandlerService,
    private readonly incomingEventPreparer: FlowIncomingEventPreparer,
  ) {}

  async prepareForRun(
    req: ConversationNextRequest,
    conversationId: string,
    turnId: string,
    shouldPersist: boolean,
  ): Promise<FlowRunPreparationResult> {
    // preparation 不修改 conversation/run/event 事实；replace 真正发生在 destination run
    // 注册后的 EventStore 事务中。图片 draft 可能在这里 materialize 为可回收的 managed file，
    // 但只有 admission 与 event/link 事务成功后才成为对话事实并释放 draft。
    const historyBeforeOperation = await this.historyHandler.readHistory(conversationId);
    const incomingBatch = await this.incomingEventPreparer.prepare({
      request: req,
      conversationId,
      turnId,
      historyBeforeTruncate: historyBeforeOperation,
      shouldPersist,
    });

    if (req.options?.persist_only === true) {
      logger.info(`[FlowRunPreparationService] persist_only=true, skipping execution. conversationId=${conversationId}`);
      return {
        kind: 'persist_only',
        result: {
          conversation_id: conversationId,
          events: [],
          stepCount: 0,
        },
        incomingBatch,
      };
    }

    const intendedPostOperationHistory = selectHistoryBeforeReplacement(req, historyBeforeOperation);
    return {
      kind: 'execute',
      prepared: this.buildPreparedRunInput(req, conversationId, incomingBatch, intendedPostOperationHistory),
    };
  }

  async prepareExecutionAfterPersistence(
    req: ConversationNextRequest,
    conversationId: string,
    incomingBatch: FlowIncomingEventBatch,
  ): Promise<PreparedFlowRunInput> {
    const persistedHistory = await this.historyHandler.readHistory(conversationId);
    const incomingIds = new Set(incomingBatch.events.map(event => event.id));
    const contextHistory = persistedHistory.filter(event => !incomingIds.has(event.id));
    logger.info(`Processed events: ${persistedHistory.length} events in history after operation`);
    return this.buildPreparedRunInput(req, conversationId, incomingBatch, contextHistory);
  }

  private buildPreparedRunInput(
    req: ConversationNextRequest,
    conversationId: string,
    incomingBatch: FlowIncomingEventBatch,
    postOperationHistory: readonly RuntimeEvent[],
  ): PreparedFlowRunInput {

    const contextOptions = req.options;
    const isHistoryIsolated = contextOptions?.history_mode === 'isolated';
    const contextHistoryEvents = isHistoryIsolated ? [] : [...postOperationHistory];
    const effectiveOptions = isHistoryIsolated
      ? {
          ...(contextOptions ?? {}),
          conversationHistory: [],
        }
      : contextOptions;

    if (isHistoryIsolated) {
      logger.info(
        `[FlowRunPreparationService] Isolated history mode, clearing context history (postOp=${postOperationHistory.length} -> contextHistory=0) and options.conversationHistory=[]`,
      );
    }

    logger.info('[FlowRunPreparationService] runner selection', {
      conversationId,
      postOpHistoryCount: postOperationHistory.length,
      contextHistoryCount: contextHistoryEvents.length,
      historyMode: contextOptions?.history_mode,
    });

    const agentInvokeReq = HistoryBuilder.buildForAgent(
      conversationId,
      [...incomingBatch.events],
      contextHistoryEvents,
      effectiveOptions,
    );

    if (!agentInvokeReq) {
      throw new Error('Failed to build Agent request from events or history');
    }

    return {
      agentInvokeReq,
      contextHistoryEvents,
      effectiveOptions,
      incomingBatch,
    };
  }
}
