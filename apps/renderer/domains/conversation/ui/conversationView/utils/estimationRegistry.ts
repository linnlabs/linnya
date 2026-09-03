export interface EstimationEntryText {
  base: number;
  min: number;
  max: number;
  fontSizePx: number;
  lineHeightPx: number;
  horizontalPaddingPx: number;
  verticalPaddingPx: number;
}

export interface EstimationEntryFixed {
  fixed: number;
}

export interface EstimationRegistry {
  cardCollapsed: EstimationEntryFixed;
  message: EstimationEntryText;
}

/**
 * 虚拟列表估高的默认起点。
 *
 * 约束：
 * - 先偏保守，避免明显低估导致的回弹；
 * - Phase 1 的真实测量回写会在此基础上持续收敛。
 */
export const defaultEstimationRegistry: EstimationRegistry = {
  cardCollapsed: { fixed: 72 },
  message: {
    base: 28,
    min: 56,
    // visual-row 会直接用该值完成 prepend 首次归位；560px 会截断正常长回答，
    // 使真实测量在下一帧突然增高。这里只保留异常估值的宽松安全上限。
    max: 8000,
    fontSizePx: 15,
    lineHeightPx: 24,
    horizontalPaddingPx: 56,
    verticalPaddingPx: 20,
  },
};

export function cloneEstimationRegistry(
  registry: EstimationRegistry = defaultEstimationRegistry
): EstimationRegistry {
  return {
    cardCollapsed: { ...registry.cardCollapsed },
    message: { ...registry.message },
  };
}
