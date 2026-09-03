import type { BaseMessage } from '../../../types';
import type { EstimationRegistry } from '../utils/estimationRegistry';
import {
  buildVisualTurnAssignments,
  createVisualRowDraft,
  createVisualRowProjectionRuntime,
  finalizeVisualRowDrafts,
  shouldProjectConversationVisualMessage,
} from './conversationVisualRowProjection';
import type { ConversationVisualRow } from '../../messageCanvas';

export interface ProjectConversationVisualRowsOptions {
  readonly estimationRegistry?: EstimationRegistry;
  readonly widthPx?: number;
}

export function projectConversationVisualRows(
  messages: readonly BaseMessage[],
  options: ProjectConversationVisualRowsOptions = {},
): ConversationVisualRow[] {
  const assignments = buildVisualTurnAssignments(messages);
  const runtime = createVisualRowProjectionRuntime(options);
  const drafts = messages.flatMap((message) => {
    if (!shouldProjectConversationVisualMessage(message)) return [];
    const visualTurnId = assignments.visualTurnIdByMessageId.get(message.id);
    if (!visualTurnId) throw new Error(`Missing visual-row turn assignment: ${message.id}`);
    return [createVisualRowDraft({ assignments, message, runtime, visualTurnId })];
  });
  return finalizeVisualRowDrafts(drafts);
}
