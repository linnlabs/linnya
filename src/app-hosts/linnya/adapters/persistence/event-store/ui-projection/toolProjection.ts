import {
  type SerializableJsonRecord,
  type SerializableJsonValue,
} from 'linnkit/contracts';
import {
  ConversationActivityBindingSchema,
  ConversationToolMessagePayloadSchema,
  mergeSubrunTraceSummaryWithAuthoritativeIds,
  readStructuredToolResultSubrunIds,
  type ConversationToolMessagePayload,
  type JsonValue,
} from '@app/schemas';
import { compactRecord, isRecord, readRecordField, toSerializableValue } from './json';
import type { UiProjectionStatus } from './types';

export type ToolProjectionEventType = 'tool_call_decision' | 'tool_process' | 'tool_output';

export type ToolProjectionPhase = 'start' | 'update' | 'complete' | 'error';

export interface ToolProjectionPatch {
  readonly type: ToolProjectionEventType;
  readonly phase: ToolProjectionPhase;
  readonly status: UiProjectionStatus;
  readonly toolName: string;
  readonly payload?: SerializableJsonRecord | null;
  readonly observation?: string;
  readonly data?: SerializableJsonValue;
  readonly error?: string;
  readonly errorCode?: string;
  readonly presentation?: SerializableJsonRecord;
  readonly eventMetadata?: SerializableJsonRecord | null;
}

export interface ToolCallLike {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export function deriveToolCallStatus(
  patch: ToolProjectionPatch,
): UiProjectionStatus {
  return patch.status;
}

export function readToolCallsFromPayload(payload: SerializableJsonRecord | null | undefined): ToolCallLike[] {
  const raw = payload?.tool_calls;
  if (!Array.isArray(raw)) {
    return [];
  }
  const calls: ToolCallLike[] = [];
  for (const item of raw) {
    if (isToolCallLike(item)) {
      calls.push(item);
    }
  }
  return calls;
}

export function parseToolCallArguments(call: ToolCallLike): SerializableJsonRecord {
  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    if (!isRecord(parsed)) {
      return {};
    }
    const output: SerializableJsonRecord = {};
    for (const [key, value] of Object.entries(parsed)) {
      output[key] = toSerializableValue(value);
    }
    return output;
  } catch {
    return {};
  }
}

export function buildInitialToolPayload(
  toolCallId: string,
  patch: ToolProjectionPatch,
  timestamp: number,
): ConversationToolMessagePayload {
  const payloadObj = patch.payload ?? null;
  const args = readRecordField(payloadObj, 'args');

  return ConversationToolMessagePayloadSchema.parse({
    tool_call_id: toolCallId,
    tool_name: patch.toolName,
    status: deriveToolCallStatus(patch),
    phase: patch.phase,
    ...(args ? { args } : {}),
    ...(patch.data === undefined ? {} : { data: patch.data }),
    ...(patch.error === undefined ? {} : { error: patch.error }),
    ...(patch.errorCode === undefined ? {} : { error_code: patch.errorCode }),
    ...(patch.presentation === undefined ? {} : { presentation: patch.presentation }),
    started_at: timestamp,
    ...(patch.status === 'loading' ? {} : { completed_at: timestamp }),
  });
}

export function patchToolPayload(
  existing: ConversationToolMessagePayload,
  patch: ToolProjectionPatch,
  timestamp: number,
): ConversationToolMessagePayload {
  const payload: Record<string, JsonValue | undefined> = { ...existing };

  payload.tool_name = patch.toolName;

  const payloadObj = patch.payload ?? null;

  const interaction = readRecordField(patch.eventMetadata, 'interaction');
  const hasInteraction = !!interaction;
  if (patch.data !== undefined && !hasInteraction) {
    payload.data = patch.data;
  }
  const authoritativeSubrunIds = readStructuredToolResultSubrunIds(
    patch.data === undefined ? undefined : { data: patch.data },
  );
  if (authoritativeSubrunIds !== null) {
    const summary = mergeSubrunTraceSummaryWithAuthoritativeIds(
      payload.subrun_summary,
      authoritativeSubrunIds,
    );
    payload.subrun_summary = {
      subrun_ids: [...summary.subrun_ids],
      event_counts: { ...summary.event_counts },
    };
  }

  if (patch.type !== 'tool_output') {
    const args = readSerializableField(payloadObj, 'args');
    if (args !== undefined) {
      payload.args = args;
    }
  }

  if (patch.error !== undefined) {
    payload.error = patch.error;
  }
  if (patch.errorCode !== undefined) {
    payload.error_code = patch.errorCode;
  }
  if (patch.presentation !== undefined && !hasInteraction) {
    payload.presentation = patch.presentation;
  }

  payload.phase = patch.phase;
  payload.status = deriveToolCallStatus(patch);
  if (payload.status === 'success' || payload.status === 'error') {
    payload.completed_at = timestamp;
  }

  if (interaction) {
    payload.interaction = toSerializableValue(interaction);
  }
  const activity = readRecordField(patch.eventMetadata, 'activity');
  if (activity) {
    payload.activity = ConversationActivityBindingSchema.parse(activity);
  }

  return ConversationToolMessagePayloadSchema.parse(compactRecord(payload));
}

export function buildToolContentFromPatch(
  patch: ToolProjectionPatch,
): string | null {
  if (readRecordField(patch.eventMetadata, 'interaction')) {
    return null;
  }
  return patch.observation ?? null;
}

function readSerializableField(
  record: SerializableJsonRecord | null | undefined,
  key: string,
): SerializableJsonValue | undefined {
  if (!record || !(key in record)) {
    return undefined;
  }
  return record[key];
}

function isToolCallLike(value: unknown): value is ToolCallLike {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type !== 'function') {
    return false;
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return false;
  }
  const fn = value.function;
  if (!isRecord(fn)) {
    return false;
  }
  return typeof fn.name === 'string'
    && fn.name.trim().length > 0
    && typeof fn.arguments === 'string';
}
