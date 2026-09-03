import type {
  AnswerMessage,
  BaseMessage,
  HistorySummaryMessage,
  SummarizationProgressMessage,
  ThoughtMessage,
  ToolCallMessage,
  UserMessage,
} from '../../types';
import type { MergeWindowAndLiveResult, WindowMessageRow } from '../definitions/messageWindow';
import {
  isConversationPerfEnabled,
  publishConversationPerf,
  readConversationPerfNowMs,
} from '../../shared/observability/conversationPerf';
import {
  findWindowLiveMessageConflictForPair,
} from './windowLiveMessageAdmission';

interface IndexedWindowRow {
  readonly row: WindowMessageRow;
  readonly index: number;
}

export interface MergeWindowAndLiveMessagesOptions {
  readonly hasMoreAfter?: boolean;
}

export function mergeWindowAndLiveMessages(
  windowRows: readonly WindowMessageRow[],
  liveMessages: readonly BaseMessage[],
  options: MergeWindowAndLiveMessagesOptions = {},
): MergeWindowAndLiveResult {
  const shouldRecordPerf = isConversationPerfEnabled();
  const startedAt = shouldRecordPerf ? readConversationPerfNowMs() : 0;
  const sortedRows = [...windowRows].sort((left, right) => left.sortSeq - right.sortSeq);
  const byMessageId = new Map<string, IndexedWindowRow>();

  sortedRows.forEach((row, index) => {
    byMessageId.set(row.message.id, { row, index });
  });
  const committedSummaryIds = new Set<string>();
  for (const row of sortedRows) {
    if (row.message.type === 'history_summary') committedSummaryIds.add(row.message.id);
  }
  for (const message of liveMessages) {
    if (message.type === 'history_summary') committedSummaryIds.add(message.id);
  }

  const mergedMessages = sortedRows.map(row => row.message);
  const liveOnly: BaseMessage[] = [];
  const conflicts: MergeWindowAndLiveResult['conflicts'][number][] = [];

  for (const live of liveMessages) {
    if (isCompletedProgressResolvedBySummary(live, committedSummaryIds)) {
      continue;
    }
    const match = byMessageId.get(live.id);
    if (!match) {
      liveOnly.push(live);
      continue;
    }

    const conflict = findWindowLiveMessageConflictForPair(match.row.message, live);
    if (conflict) {
      conflicts.push(conflict);
      continue;
    }

    mergedMessages[match.index] = mergeWindowMessageWithLivePatch(match.row.message, live);
  }

  /**
   * 当历史窗口尾部不是会话真实尾部时，liveOnly 与窗口之间存在一段未加载消息。
   * 这时只能让 live 覆盖窗口内已有行，不能把 liveOnly 接到窗口尾部伪造成连续列表。
   */
  const tailMessages = options.hasMoreAfter === true ? [] : liveOnly;

  const result = {
    rows: sortedRows,
    messages: [...mergedMessages, ...tailMessages],
    conflicts,
  };
  if (shouldRecordPerf) {
    publishConversationPerf({
      kind: 'window-prepend',
      phase: 'merge',
      durationMs: readConversationPerfNowMs() - startedAt,
      details: {
        windowRowCount: windowRows.length,
        liveMessageCount: liveMessages.length,
        outputMessageCount: result.messages.length,
        hasMoreAfter: options.hasMoreAfter === true,
      },
    });
  }
  return result;
}

/**
 * realtime progress 与 durable summary 拥有不同 message ID；恢复合成必须使用 end 明确
 * 记录的 fact ID 关联，不能按“同 run 最近一条摘要”猜测，否则同一 run 多次压缩会串线。
 */
function isCompletedProgressResolvedBySummary(
  message: BaseMessage,
  committedSummaryIds: ReadonlySet<string>,
): boolean {
  return message.type === 'summarization_progress'
    && message.metadata.summary.status === 'completed'
    && committedSummaryIds.has(message.metadata.summary.historySummaryId);
}

function mergeWindowMessageWithLivePatch(windowMessage: BaseMessage, livePatch: BaseMessage): BaseMessage {
  /**
   * 中文说明：
   * - window 持有完整历史实体，live 只持有当前 transport 到达的增量字段；
   * - tool_output 不能用空 live 实体覆盖问卷的 args，否则提交后会退化为“暂无问题”；
   * - window 与 live 必须使用相同 message_id；身份不一致属于投影合同错误，禁止按业务字段猜测合并。
   */
  switch (windowMessage.type) {
    case 'user_input':
      if (livePatch.type !== 'user_input') return windowMessage;
      return mergeUserMessage(windowMessage, livePatch);
    case 'thought':
      if (livePatch.type !== 'thought') return windowMessage;
      return mergeThoughtMessage(windowMessage, livePatch);
    case 'tool_calls':
      if (livePatch.type !== 'tool_calls') return windowMessage;
      return mergeToolMessage(windowMessage, livePatch);
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
      if (!isAnswerMessage(livePatch)) return windowMessage;
      return mergeAnswerMessage(windowMessage, livePatch);
    case 'history_summary':
      if (livePatch.type !== 'history_summary') return windowMessage;
      return mergeHistorySummaryMessage(windowMessage, livePatch);
    case 'summarization_progress':
      if (livePatch.type !== 'summarization_progress') return windowMessage;
      return mergeSummarizationProgressMessage(windowMessage, livePatch);
  }
}

function mergeCommonFields<Message extends BaseMessage>(
  windowMessage: Message,
  livePatch: Message,
  preferWindowSealedSnapshot = false,
): Pick<Message, 'id' | 'content' | 'attachments' | 'timestamp' | 'citationDependencies'> {
  const useLiveContent = !preferWindowSealedSnapshot && livePatch.content.length > 0;
  const citationDependencies = preferWindowSealedSnapshot
    ? windowMessage.citationDependencies
    : useLiveContent
      ? livePatch.citationDependencies
      : windowMessage.citationDependencies;
  return {
    id: windowMessage.id,
    content: useLiveContent ? livePatch.content : windowMessage.content,
    attachments: livePatch.attachments ?? windowMessage.attachments,
    timestamp: livePatch.timestamp,
    ...(citationDependencies ? { citationDependencies } : {}),
  };
}

function mergeUserMessage(windowMessage: UserMessage, livePatch: UserMessage): UserMessage {
  return {
    ...mergeCommonFields(windowMessage, livePatch),
    role: 'user',
    type: 'user_input',
    metadata: { ...(windowMessage.metadata ?? {}), ...(livePatch.metadata ?? {}) },
  };
}

function mergeThoughtMessage(windowMessage: ThoughtMessage, livePatch: ThoughtMessage): ThoughtMessage {
  return {
    ...mergeCommonFields(
      windowMessage,
      livePatch,
      windowMessage.metadata.is_complete && livePatch.metadata.is_complete,
    ),
    role: 'assistant',
    type: 'thought',
    metadata: { ...windowMessage.metadata, ...livePatch.metadata },
  };
}

function mergeToolMessage(windowMessage: ToolCallMessage, livePatch: ToolCallMessage): ToolCallMessage {
  if (windowMessage.metadata.status !== 'loading' && livePatch.metadata.status === 'loading') {
    /**
     * 取消或导航竞态下，SSE 可以在 tool_output 到达前中断，而 durable read model 已经
     * 完成结算。此时 window 是工具生命周期的较新权威事实，不能被陈旧 live loading
     * 覆盖；但 subrun trace 只存在于 live projection，仍需保留给父工具卡展示。
     */
    return {
      id: windowMessage.id,
      role: 'assistant',
      type: 'tool_calls',
      content: windowMessage.content,
      attachments: windowMessage.attachments,
      timestamp: windowMessage.timestamp,
      ...(windowMessage.toolPresentation
        ? { toolPresentation: windowMessage.toolPresentation }
        : {}),
      metadata: {
        ...livePatch.metadata,
        ...windowMessage.metadata,
        subrunTrace: livePatch.metadata.subrunTrace ?? windowMessage.metadata.subrunTrace,
        subrunTraceVersion:
          livePatch.metadata.subrunTraceVersion ?? windowMessage.metadata.subrunTraceVersion,
      },
    };
  }

  return {
    ...mergeCommonFields(windowMessage, livePatch),
    role: 'assistant',
    type: 'tool_calls',
    ...(livePatch.toolPresentation
      ? { toolPresentation: livePatch.toolPresentation }
      : {}),
    metadata: {
      ...windowMessage.metadata,
      ...livePatch.metadata,
    },
  };
}

function isAnswerMessage(message: BaseMessage): message is AnswerMessage {
  return message.type === 'final_answer'
    || message.type === 'tool_preamble'
    || message.type === 'partial_answer';
}

function mergeAnswerMessage(windowMessage: AnswerMessage, livePatch: AnswerMessage): AnswerMessage {
  if (
    windowMessage.metadata.completion_reason !== undefined
    && livePatch.metadata.completion_reason === undefined
  ) {
    /** durable 已看到该 attempt 的 seal，陈旧 live chunk 不能让答案退回流式态。 */
    return windowMessage;
  }

  const common = mergeCommonFields(
    windowMessage,
    livePatch,
    windowMessage.metadata.completion_reason !== undefined
      && livePatch.metadata.completion_reason !== undefined,
  );
  switch (livePatch.type) {
    case 'final_answer':
      return {
        ...common,
        role: 'assistant',
        type: livePatch.type,
        metadata: {
          ...livePatch.metadata,
          final_meta: livePatch.metadata.final_meta ?? windowMessage.metadata.final_meta,
          activity: livePatch.metadata.activity ?? windowMessage.metadata.activity,
          execution_id: livePatch.metadata.execution_id ?? windowMessage.metadata.execution_id,
          merge_key: livePatch.metadata.merge_key ?? windowMessage.metadata.merge_key,
          ui: livePatch.metadata.ui ?? windowMessage.metadata.ui,
          last_seq: livePatch.metadata.last_seq ?? windowMessage.metadata.last_seq,
          seal_source_event_id:
            livePatch.metadata.seal_source_event_id ?? windowMessage.metadata.seal_source_event_id,
        },
      };
    case 'tool_preamble':
      return {
        ...common,
        role: 'assistant',
        type: livePatch.type,
        metadata: {
          ...livePatch.metadata,
          final_meta: livePatch.metadata.final_meta ?? windowMessage.metadata.final_meta,
          activity: livePatch.metadata.activity ?? windowMessage.metadata.activity,
          execution_id: livePatch.metadata.execution_id ?? windowMessage.metadata.execution_id,
          merge_key: livePatch.metadata.merge_key ?? windowMessage.metadata.merge_key,
          ui: livePatch.metadata.ui ?? windowMessage.metadata.ui,
          last_seq: livePatch.metadata.last_seq ?? windowMessage.metadata.last_seq,
          seal_source_event_id:
            livePatch.metadata.seal_source_event_id ?? windowMessage.metadata.seal_source_event_id,
        },
      };
    case 'partial_answer':
      return {
        ...common,
        role: 'assistant',
        type: livePatch.type,
        metadata: {
          ...livePatch.metadata,
          final_meta: livePatch.metadata.final_meta ?? windowMessage.metadata.final_meta,
          activity: livePatch.metadata.activity ?? windowMessage.metadata.activity,
          execution_id: livePatch.metadata.execution_id ?? windowMessage.metadata.execution_id,
          merge_key: livePatch.metadata.merge_key ?? windowMessage.metadata.merge_key,
          ui: livePatch.metadata.ui ?? windowMessage.metadata.ui,
          last_seq: livePatch.metadata.last_seq ?? windowMessage.metadata.last_seq,
          seal_source_event_id:
            livePatch.metadata.seal_source_event_id ?? windowMessage.metadata.seal_source_event_id,
        },
      };
  }
}

function mergeHistorySummaryMessage(
  windowMessage: HistorySummaryMessage,
  livePatch: HistorySummaryMessage,
): HistorySummaryMessage {
  return {
    ...mergeCommonFields(windowMessage, livePatch),
    role: 'system',
    type: 'history_summary',
    metadata: { ...windowMessage.metadata, ...livePatch.metadata },
  };
}

function mergeSummarizationProgressMessage(
  windowMessage: SummarizationProgressMessage,
  livePatch: SummarizationProgressMessage,
): SummarizationProgressMessage {
  return {
    ...mergeCommonFields(windowMessage, livePatch),
    role: 'system',
    type: 'summarization_progress',
    metadata: { ...windowMessage.metadata, ...livePatch.metadata },
  };
}
