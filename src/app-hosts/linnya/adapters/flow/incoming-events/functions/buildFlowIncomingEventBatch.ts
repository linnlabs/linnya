import type { ConversationNextRequest, IncrementalEvent } from '@app/schemas';
import {
  toSerializableJsonRecord,
  type RuntimeEvent,
  type RuntimeResourceRef,
  type SerializableJsonRecord,
  ToolCallIdSchema,
} from 'linnkit/contracts';
import { normalizeIncrementalUserInputEvent } from 'src/app-hosts/linnya/context/agent/userInputContext';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';
import type { FlowIncomingEventBatch } from '../definitions/flowIncomingEventBatch';

type IncrementalUserInput = Extract<IncrementalEvent, { type: 'user_input' }>;
type IncrementalToolOutput = Extract<IncrementalEvent, { type: 'tool_output' }>;

export interface ResolvedFlowUserAttachments {
  readonly eventId: string;
  readonly attachments: readonly RuntimeResourceRef[];
  readonly assetCommits: readonly WorkspaceAssetCommitRecord[];
  readonly committedDraftIds: readonly string[];
}

function buildIncomingEventMetadata(
  baseMetadata: unknown,
  optionActivity: unknown,
  optionUi?: unknown
): SerializableJsonRecord | undefined {
  const metadata = toSerializableJsonRecord({
    ...(toSerializableJsonRecord(baseMetadata) ?? {}),
    ...(optionActivity ? { activity: optionActivity } : {}),
    ...(optionUi ? { ui: optionUi } : {}),
  });
  return metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
}

function requireEventId(event: IncrementalEvent): string {
  if (
    typeof event.id !== 'string' ||
    event.id.trim().length === 0 ||
    event.id !== event.id.trim()
  ) {
    throw new Error('[FlowIncomingEvents] incoming event 必须先在编排入口分配稳定 ID');
  }
  return event.id;
}

function buildUserInputEvent(params: {
  readonly event: IncrementalUserInput;
  readonly conversationId: string;
  readonly turnId: string;
  readonly optionActivity: unknown;
  readonly optionUi: unknown;
  readonly resolvedAttachments?: ResolvedFlowUserAttachments;
}): RuntimeEvent {
  const normalized = normalizeIncrementalUserInputEvent(params.event);
  const eventId = requireEventId(params.event);
  if (params.resolvedAttachments && params.resolvedAttachments.eventId !== eventId) {
    throw new Error(
      `[FlowIncomingEvents] attachment aggregate does not belong to event ${eventId}`
    );
  }
  const metadata = buildIncomingEventMetadata(
    normalized.metadata,
    params.optionActivity,
    params.optionUi
  );
  const attachments = params.resolvedAttachments?.attachments ?? [];

  return {
    type: 'user_input',
    id: eventId,
    conversation_id: params.conversationId,
    turn_id: normalized.turn_id || params.turnId,
    timestamp: normalized.timestamp,
    version: 1,
    content: normalized.content,
    // 图片-only 的空 raw_content 也是事实，不能因 falsy 判断退化为带时间标签的展示文本。
    raw_content: normalized.raw_content,
    source: normalized.source,
    ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function buildToolOutputEvent(params: {
  readonly event: IncrementalToolOutput;
  readonly conversationId: string;
  readonly turnId: string;
  readonly optionActivity: unknown;
}): RuntimeEvent {
  const metadata = buildIncomingEventMetadata(params.event.metadata, params.optionActivity);
  return {
    type: 'tool_output',
    id: requireEventId(params.event),
    conversation_id: params.conversationId,
    turn_id: params.event.turn_id || params.turnId,
    timestamp: params.event.timestamp,
    version: 1,
    tool_name: params.event.tool_name,
    tool_call_id: ToolCallIdSchema.parse(params.event.tool_call_id),
    status: params.event.status,
    observation: params.event.observation,
    ...(params.event.status === 'success'
      ? { data: params.event.data }
      : { error: params.event.error }),
    ...(metadata ? { metadata } : {}),
  };
}

export function buildFlowIncomingEventBatch(params: {
  readonly request: ConversationNextRequest;
  readonly conversationId: string;
  readonly turnId: string;
  readonly resolvedUserAttachments: readonly ResolvedFlowUserAttachments[];
}): FlowIncomingEventBatch {
  const attachmentsByEventId = new Map(
    params.resolvedUserAttachments.map(item => [item.eventId, item] as const)
  );
  if (attachmentsByEventId.size !== params.resolvedUserAttachments.length) {
    throw new Error('[FlowIncomingEvents] 同一个 user event 只能有一个附件聚合');
  }

  const newEvents = params.request.new_events ?? [];
  const events = newEvents.map((event): RuntimeEvent => {
    if (event.type === 'user_input') {
      return buildUserInputEvent({
        event,
        conversationId: params.conversationId,
        turnId: params.turnId,
        optionActivity: params.request.options?.activity,
        optionUi: params.request.options?.ui,
        resolvedAttachments: attachmentsByEventId.get(requireEventId(event)),
      });
    }
    return buildToolOutputEvent({
      event,
      conversationId: params.conversationId,
      turnId: params.turnId,
      optionActivity: params.request.options?.activity,
    });
  });

  const consumedUserIds = new Set(
    events.filter(event => event.type === 'user_input').map(event => event.id)
  );
  for (const eventId of attachmentsByEventId.keys()) {
    if (!consumedUserIds.has(eventId)) {
      throw new Error(`[FlowIncomingEvents] 找不到附件聚合对应的 user event: ${eventId}`);
    }
  }

  return {
    events,
    assetCommitsByEventId: new Map(
      params.resolvedUserAttachments
        .filter(item => item.assetCommits.length > 0)
        .map(item => [item.eventId, item.assetCommits] as const)
    ),
    committedDraftIds: [
      ...new Set(params.resolvedUserAttachments.flatMap(item => item.committedDraftIds)),
    ],
  };
}
