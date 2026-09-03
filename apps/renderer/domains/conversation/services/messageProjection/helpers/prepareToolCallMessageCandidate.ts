import {
  ConversationToolMessageMetadataSchema,
  type ConversationMessageId,
  type ConversationToolMessageMetadata,
} from '@app/schemas';

import { projectToolCardPresentation } from '../../../ports/toolPresentationProjectionPort';
import { ToolMessageService } from '../../message/tool/toolMessageService';
import { buildToolResultFromMessage } from '../../message/tool/buildToolResultFromMessage';
import type { ActivityBinding, ToolCallMessage } from '../../../types';

export interface ToolCallUpsertPatch {
  type: 'tool_call_decision' | 'tool_process' | 'tool_output';
  phase: 'start' | 'update' | 'complete' | 'error';
  toolName: string;
  payload?: Record<string, unknown> | null;
  observation?: string;
  data?: unknown;
  error?: string;
  errorCode?: string;
  presentation?: Record<string, unknown>;
  eventMetadata?: Record<string, unknown> | null;
  status: 'loading' | 'success' | 'error';
  rawEvent?: unknown;
}

export interface ToolCallMessageCandidateIdentity {
  readonly messageId: ConversationMessageId;
  readonly toolCallId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly executionId?: string;
  readonly activity?: ActivityBinding;
}

function buildInitialMetadata(
  identity: ToolCallMessageCandidateIdentity,
  patch: ToolCallUpsertPatch,
  timestamp: number,
): ConversationToolMessageMetadata {
  const metadata = ToolMessageService.buildInitialMetadata(identity.toolCallId, patch);
  return ConversationToolMessageMetadataSchema.parse({
    ...metadata,
    turn_id: identity.turnId,
    run_id: identity.runId,
    ...(identity.executionId ? { execution_id: identity.executionId } : {}),
    started_at: timestamp,
    ...(metadata.status === 'loading' ? {} : { completed_at: timestamp }),
    ...(identity.activity ? { activity: identity.activity } : {}),
  });
}

function requireOwnedPreviousMetadata(
  message: ToolCallMessage,
  identity: ToolCallMessageCandidateIdentity,
): ConversationToolMessageMetadata {
  const metadata = ConversationToolMessageMetadataSchema.parse(message.metadata);
  if (
    metadata.tool_call_id !== identity.toolCallId
    || metadata.turn_id !== identity.turnId
    || metadata.run_id !== identity.runId
  ) {
    throw new Error(
      `[TOOL_MESSAGE_IDENTITY_CONFLICT] message=${message.id}, toolCall=${identity.toolCallId}`,
    );
  }
  return metadata;
}

/**
 * 主时间线与 Subrun 详情共同使用的最小工具消息能力。
 *
 * 这里只在 detached candidate 上完成 metadata/result/presentation admission；消息索引、
 * run toolState、Subrun bucket 与最终 commit 仍由各自 owner 持有。
 */
export function prepareToolCallMessageCandidate(params: {
  readonly previousMessage: ToolCallMessage | null;
  readonly identity: ToolCallMessageCandidateIdentity;
  readonly patch: ToolCallUpsertPatch;
  readonly timestamp: number;
}): ToolCallMessage {
  const previousMetadata = params.previousMessage
    ? requireOwnedPreviousMetadata(params.previousMessage, params.identity)
    : buildInitialMetadata(params.identity, params.patch, params.timestamp);
  const metadata = ConversationToolMessageMetadataSchema.parse({
    ...ToolMessageService.patchMetadata(previousMetadata, params.patch, params.timestamp),
    started_at: previousMetadata.started_at,
  });
  const content = ToolMessageService.buildContentFromPatch(params.patch)
    ?? params.previousMessage?.content
    ?? '';
  const toolResult = buildToolResultFromMessage(content, metadata);
  const toolPresentation = projectToolCardPresentation({
    sourceToolName: metadata.tool_name,
    toolCallId: metadata.tool_call_id,
    args: metadata.args ?? {},
    result: toolResult,
    interaction: metadata.interaction,
    subrunSummary: metadata.subrun_summary,
    status: metadata.status,
    phase: metadata.phase,
  });

  return {
    id: params.previousMessage?.id ?? params.identity.messageId,
    role: 'assistant',
    type: 'tool_calls',
    content,
    ...(params.previousMessage?.attachments
      ? { attachments: params.previousMessage.attachments }
      : {}),
    timestamp: params.timestamp,
    metadata,
    ...(toolPresentation ? { toolPresentation } : {}),
  };
}
