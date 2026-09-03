/*
 * @file apps/renderer/domains/conversation/services/message/tool/toolEventAdapter.ts
 * @description 工具事件到消息元数据的适配器纯函数
 */

import { deriveToolCallStatus } from './toolEvent';
import { isRecord } from '../../../utils/typeGuards';
import {
  ConversationToolMessageMetadataSchema,
  JsonRecordSchema,
  JsonValueSchema,
  mergeSubrunTraceSummaryWithAuthoritativeIds,
  readStructuredToolResultSubrunIds,
  type ConversationToolMessageMetadata,
} from '@app/schemas';

export interface ToolCallPatch {
  type: 'tool_call_decision' | 'tool_process' | 'tool_output';
  phase: 'start' | 'update' | 'complete' | 'error';
  status: 'loading' | 'success' | 'error';
  toolName: string;
  payload?: Record<string, unknown> | null;
  observation?: string;
  data?: unknown;
  error?: string;
  errorCode?: string;
  presentation?: Record<string, unknown>;
  eventMetadata?: Record<string, unknown> | null;
}

function readInteractionMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const interaction = value['interaction'];
  return isRecord(interaction) ? interaction : undefined;
}

export function buildInitialToolCallMetadata(
  toolCallId: string,
  patch: ToolCallPatch,
): Pick<
  ConversationToolMessageMetadata,
  'tool_call_id' | 'tool_name' | 'status' | 'phase' | 'args' | 'data' | 'error' | 'error_code' | 'presentation'
> {
  const payloadObj = patch.payload ?? undefined;
  const args = payloadObj && isRecord(payloadObj) && isRecord(payloadObj['args'])
    ? JsonRecordSchema.parse(payloadObj['args'])
    : undefined;
  return {
    tool_call_id: toolCallId,
    tool_name: patch.toolName,
    status: deriveToolCallStatus(patch),
    phase: patch.phase,
    args,
    data: patch.data === undefined ? undefined : JsonValueSchema.parse(patch.data),
    error: patch.error,
    error_code: patch.errorCode,
    presentation: patch.presentation === undefined
      ? undefined
      : JsonRecordSchema.parse(patch.presentation),
  };
}

export function patchToolCallMetadata(
  existing: ConversationToolMessageMetadata,
  patch: ToolCallPatch,
  timestamp: number,
): ConversationToolMessageMetadata {
  const metadata: Record<string, unknown> = { ...existing };

  metadata.tool_name = patch.toolName;

  const payloadObj = patch.payload;
  const interactionPatch = readInteractionMetadata(patch.eventMetadata);
  const isInteractionResponse = interactionPatch?.status !== undefined
    && interactionPatch.status !== 'active';

  if (patch.data !== undefined) {
    if (!isInteractionResponse) {
      metadata.data = JsonValueSchema.parse(patch.data);
    }
    const authoritativeSubrunIds = readStructuredToolResultSubrunIds({ data: patch.data });
    if (authoritativeSubrunIds !== null) {
      metadata.subrun_summary = mergeSubrunTraceSummaryWithAuthoritativeIds(
        metadata.subrun_summary,
        authoritativeSubrunIds,
      );
    }
  }

  if (patch.error !== undefined) {
    metadata.error = patch.error;
  }
  if (patch.errorCode !== undefined) {
    metadata.error_code = patch.errorCode;
  }
  if (patch.presentation !== undefined && !isInteractionResponse) {
    metadata.presentation = JsonRecordSchema.parse(patch.presentation);
  }

  /**
   * ✅ 支持“工具参数流式/增量更新”的关键点：同步 metadata.args
   *
   * 背景：
   * - ToolCallsMessage 的 toolArgs 计算属性**优先**使用 metadata.args（权威、后端规范化后的结构）；
   * - 但此前 metadata.args 只在 buildInitialToolCallMetadata 时读取一次，后续过程事件不会更新，
   *   导致后端即便发送 action.phase='update' 的 args 快照，UI 也无法“丝滑渲染”工具入参。
   *
   * 约定（严格、非猜测）：
   * - 后端在 `tool_call_decision` / `tool_process` 事件里提供的 args 应是“当前时刻的完整快照”（而不是 delta），前端直接替换即可；
   * - 若后端未来提供真正的 delta（例如 tool_args_delta），应在事件协议层显式区分，再在此处实现合并策略。
   */
  if (patch.type !== 'tool_output' && payloadObj && isRecord(payloadObj) && 'args' in payloadObj) {
    metadata.args = payloadObj['args'];
  }

  metadata.phase = patch.phase;

  metadata.status = deriveToolCallStatus(patch);

  if (metadata.status === 'success' || metadata.status === 'error') {
    metadata.completed_at = timestamp;
  }

  if (interactionPatch) {
    metadata.interaction = interactionPatch;
  }

  return ConversationToolMessageMetadataSchema.parse(metadata);
}
