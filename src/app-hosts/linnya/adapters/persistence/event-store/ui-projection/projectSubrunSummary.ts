import {
  ConversationToolMessagePayloadSchema,
  conversationMessageIdFromToolIdentity,
  mergeSubrunTraceSummaryWithAuthoritativeIds,
  readStructuredToolResultSubrunIds,
  type SubrunTraceSummary,
} from '@app/schemas';
import type { UiProjectionReadAccess, UiRowOp } from './types';

/** 紧凑历史只修订现有父 row 的索引；nested child 不因此变成主时间线消息。 */
export function projectSubrunSummaryToUiRowOp(
  input: {
    readonly conversationId: string;
    readonly parentRunId: string;
    readonly parentToolCallId: string;
    readonly summary: SubrunTraceSummary;
  },
  access: UiProjectionReadAccess,
): Extract<UiRowOp, { op: 'replace' }> | undefined {
  const parent = access.getRowByMergeKey(input.conversationId,
    conversationMessageIdFromToolIdentity(input.parentRunId, input.parentToolCallId));
  if (!parent) return undefined;
  if (parent.messageType !== 'tool_calls') {
    throw new Error(`Tool merge key ${input.parentToolCallId} points to ${parent.messageType}`);
  }
  // 正式结果决定稳定顺序，但不能删除已经启动、尚未产出 artifact 的 child。
  const summary = mergeSubrunTraceSummaryWithAuthoritativeIds(
    input.summary,
    readStructuredToolResultSubrunIds({ data: parent.payload.data }) ?? [],
  );
  return {
    op: 'replace',
    row: {
      ...parent,
      payload: ConversationToolMessagePayloadSchema.parse({
        ...parent.payload,
        subrun_summary: summary,
      }),
    },
  };
}
