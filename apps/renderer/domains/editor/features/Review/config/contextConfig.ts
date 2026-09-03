/**
 * @file apps/renderer/domains/editor/features/Review/config/contextConfig.ts
 * @description Review（审阅）功能的上下文/分段配置（按块分段）
 *
 * 设计目标：
 * - 审阅必须覆盖全篇：因此采用"按块分段"多次调用 AI
 * - 每个 chunk 由若干"完整 rootBlock"组成，禁止把单个块切断
 * - 输出给模型的 `document_fragment` 必须是 DocumentView 协议（含 `[#ref]`），并携带 document_id
 */

export interface ReviewContextConfig {
  /**
   * 单个 chunk 最多包含多少个块（rootBlock）。
   *
   * 说明：
   * - 这是最稳定的分段策略：不会把 `[#ref]` 行切断
   * - 数值越大，单次请求 token 越多
   */
  maxBlocksPerChunk: number;

  /**
   * 单个 chunk 最大字符数限制。
   *
   * 说明：
   * - Review 是单次 Agent 调用，不会有超长对话累积
   * - 该限制确保单次请求不会超过模型 token 上限
   */
  maxCharsPerChunk: number;
}

/**
 * 🎯 Review 的默认分段策略（MVP）
 *
 * 经验值：
 * - maxBlocksPerChunk: 最多 80 块
 * - maxCharsPerChunk: 最大 10000 字符
 * - 两个条件取先满足者，确保单次请求可控
 */
export const REVIEW_CONTEXT: ReviewContextConfig = {
  maxBlocksPerChunk: 80,
  maxCharsPerChunk: 10000,
};

export function getReviewContextConfig(): ReviewContextConfig {
  return REVIEW_CONTEXT;
}


