import type { BaseMessage } from '../../../types';
import type { ConversationVisualRow } from '../../messageCanvas';
import type { EstimationRegistry } from '../utils/estimationRegistry';
import {
  appendVisualTurnAssignment,
  buildVisualTurnAssignments,
  createVisualRowDraft,
  createVisualRowProjectionRuntime,
  finalizeVisualRowDrafts,
  shouldProjectConversationVisualMessage,
  type EstimateVisualMessageLayout,
  type VisualRowDraft,
  type VisualRowProjectionRuntime,
  type VisualTurnAssignmentState,
} from './conversationVisualRowProjection';

export interface AppendOnlyConversationVisualRowsOptions {
  readonly estimationRegistry?: EstimationRegistry;
  readonly widthPx?: number;
}

export interface AppendOnlyConversationVisualRowsDiagnostics {
  readonly appendedMessages: number;
  readonly fullRebuilds: number;
  readonly tailContentUpdates: number;
  readonly messageRevisionUpdates: number;
}

interface BuilderState {
  assignments: VisualTurnAssignmentState;
  rows: ConversationVisualRow[];
  rowIndexByMessageId: Map<string, number>;
  processedCount: number;
  firstProcessedId: string;
  lastProcessedId: string;
  lastMessageContent: string;
  messageRefs: BaseMessage[];
  widthPx?: number;
  registry: EstimationRegistry;
}

function appendFinalizedDraft(rows: ConversationVisualRow[], draft: VisualRowDraft): void {
  const previousIndex = rows.length - 1;
  const previous = rows[previousIndex];
  if (previous && previous.visualTurnId === draft.visualTurnId && previous.isTurnEnd) {
    rows[previousIndex] = { ...previous, isTurnEnd: false };
  }
  rows.push({
    ...draft,
    isTurnStart: !previous || previous.visualTurnId !== draft.visualTurnId,
    isTurnEnd: true,
  });
}

export function createAppendOnlyConversationVisualRowsBuilder(
  dependencies: { readonly estimateMessageLayout?: EstimateVisualMessageLayout } = {},
) {
  let state: BuilderState | null = null;
  let diagnostics: AppendOnlyConversationVisualRowsDiagnostics = {
    appendedMessages: 0,
    fullRebuilds: 0,
    tailContentUpdates: 0,
    messageRevisionUpdates: 0,
  };

  const fullRebuild = (
    messages: readonly BaseMessage[],
    options: AppendOnlyConversationVisualRowsOptions,
  ): ConversationVisualRow[] => {
    const runtime = createVisualRowProjectionRuntime({
      ...options,
      estimateMessageLayout: dependencies.estimateMessageLayout,
    });
    const assignments = buildVisualTurnAssignments(messages);
    const drafts = messages.flatMap((message) => {
      if (!shouldProjectConversationVisualMessage(message)) return [];
      const visualTurnId = assignments.visualTurnIdByMessageId.get(message.id);
      if (!visualTurnId) throw new Error(`Missing visual-row turn assignment: ${message.id}`);
      return [createVisualRowDraft({ assignments, message, runtime, visualTurnId })];
    });
    const rows = finalizeVisualRowDrafts(drafts);
    const lastMessage = messages[messages.length - 1] ?? null;
    state = {
      assignments,
      rows,
      rowIndexByMessageId: new Map(rows.map((row, index) => [row.payload.id, index] as const)),
      processedCount: messages.length,
      firstProcessedId: messages[0]?.id ?? '',
      lastProcessedId: lastMessage?.id ?? '',
      lastMessageContent: lastMessage?.content ?? '',
      messageRefs: [...messages],
      widthPx: options.widthPx,
      registry: runtime.registry,
    };
    diagnostics = { ...diagnostics, fullRebuilds: diagnostics.fullRebuilds + 1 };
    return rows;
  };

  const changesVisualRowStructure = (previous: BaseMessage, current: BaseMessage): boolean => {
    return previous.id !== current.id
      || previous.role !== current.role
      || previous.type !== current.type
      || previous.metadata?.['turn_id'] !== current.metadata?.['turn_id']
      || shouldProjectConversationVisualMessage(previous) !== shouldProjectConversationVisualMessage(current);
  };

  const applyMessageRevision = (
    message: BaseMessage,
    runtime: VisualRowProjectionRuntime,
  ): void => {
    if (!state) return;
    const rowIndex = state.rowIndexByMessageId.get(message.id);
    if (rowIndex === undefined) return;
    const current = state.rows[rowIndex];
    if (!current) return;
    const draft = createVisualRowDraft({
      assignments: state.assignments,
      message,
      runtime,
      visualTurnId: current.visualTurnId,
    });
    state.rows[rowIndex] = {
      ...draft,
      isTurnStart: current.isTurnStart,
      isTurnEnd: current.isTurnEnd,
    };
    diagnostics = {
      ...diagnostics,
      messageRevisionUpdates: diagnostics.messageRevisionUpdates + 1,
    };
  };

  const applyTailContentUpdate = (
    message: BaseMessage,
    runtime: VisualRowProjectionRuntime,
  ): ConversationVisualRow[] => {
    if (!state) return [];
    const rowIndex = state.rowIndexByMessageId.get(message.id);
    if (rowIndex === undefined) return state.rows;
    const current = state.rows[rowIndex];
    if (!current) return state.rows;
    const draft = createVisualRowDraft({
      assignments: state.assignments,
      message,
      runtime,
      visualTurnId: current.visualTurnId,
    });
    state.rows[rowIndex] = {
      ...draft,
      isTurnStart: current.isTurnStart,
      isTurnEnd: current.isTurnEnd,
    };
    diagnostics = { ...diagnostics, tailContentUpdates: diagnostics.tailContentUpdates + 1 };
    return state.rows;
  };

  const apply = (
    messages: readonly BaseMessage[],
    options: AppendOnlyConversationVisualRowsOptions,
  ): ConversationVisualRow[] => {
    if (!state) return fullRebuild(messages, options);
    const registry = createVisualRowProjectionRuntime(options).registry;
    const boundaryId = state.processedCount > 0 ? messages[state.processedCount - 1]?.id ?? '' : '';
    const structureChanged = options.widthPx !== state.widthPx
      || registry !== state.registry
      || messages.length < state.processedCount
      || (state.processedCount > 0 && messages[0]?.id !== state.firstProcessedId)
      || (state.processedCount > 0 && boundaryId !== state.lastProcessedId);
    if (structureChanged) return fullRebuild(messages, options);

    const runtime = createVisualRowProjectionRuntime({
      ...options,
      estimateMessageLayout: dependencies.estimateMessageLayout,
    });
    for (let index = 0; index < state.processedCount; index += 1) {
      const current = messages[index];
      const previous = state.messageRefs[index];
      if (!current || !previous || current === previous) continue;
      if (changesVisualRowStructure(previous, current)) return fullRebuild(messages, options);
      applyMessageRevision(current, runtime);
      state.messageRefs[index] = current;
      if (index === state.processedCount - 1) state.lastMessageContent = current.content;
    }

    if (messages.length === state.processedCount) {
      const lastMessage = messages[messages.length - 1] ?? null;
      if (!lastMessage) return state.rows;
      // 同引用只允许流式正文原地增长；结构化 revision 必须由投影器替换对象表达。
      if (lastMessage.content === state.lastMessageContent) return state.rows;
      state.lastMessageContent = lastMessage.content;
      return applyTailContentUpdate(lastMessage, runtime);
    }

    for (let index = state.processedCount; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message) continue;
      if (shouldProjectConversationVisualMessage(message)) {
        const visualTurnId = appendVisualTurnAssignment(state.assignments, message);
        const draft = createVisualRowDraft({
          assignments: state.assignments,
          message,
          runtime,
          visualTurnId,
        });
        appendFinalizedDraft(state.rows, draft);
        state.rowIndexByMessageId.set(message.id, state.rows.length - 1);
      }
      diagnostics = { ...diagnostics, appendedMessages: diagnostics.appendedMessages + 1 };
      state.messageRefs[index] = message;
    }

    const lastMessage = messages[messages.length - 1] ?? null;
    state.processedCount = messages.length;
    state.firstProcessedId = messages[0]?.id ?? '';
    state.lastProcessedId = lastMessage?.id ?? '';
    state.lastMessageContent = lastMessage?.content ?? '';
    return state.rows;
  };

  return {
    apply,
    getDiagnostics: () => diagnostics,
    reset: () => {
      state = null;
      diagnostics = {
        appendedMessages: 0,
        fullRebuilds: 0,
        tailContentUpdates: 0,
        messageRevisionUpdates: 0,
      };
    },
  };
}
