export interface ConversationEstimationWidthInput {
  readonly contentColumnWidthPx: number;
  readonly contentSideGapPx: number;
}

const MIN_CONVERSATION_ESTIMATION_WIDTH_PX = 360;

/**
 * 估高宽度直接来自真实消息列，这里只扣除 visual row 两侧共享留白。
 * 按整像素提交与 estimator 的缓存键口径一致，避免亚像素抖动制造无效 rebuild。
 */
export function resolveConversationEstimationWidth(
  input: ConversationEstimationWidthInput,
): number {
  const availableWidth = input.contentColumnWidthPx - input.contentSideGapPx * 2;
  return Math.max(Math.round(availableWidth), MIN_CONVERSATION_ESTIMATION_WIDTH_PX);
}
