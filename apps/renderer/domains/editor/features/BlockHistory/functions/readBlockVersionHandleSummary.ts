import type { BlockVersionHandleSummary } from '../definitions/blockVersionHandleSummary';

export interface BlockVersionSummaryCandidate {
  version_number: number;
}

/**
 * 读取块历史入口按钮所需的最小摘要。
 *
 * 中文说明：左侧控制岛迁移到 BlockChromeHost 后，不应该再把 editor / node / getPos
 * 传进版本按钮；版本按钮只需要这三个展示事实，打开历史视图的流程另由编排处理。
 */
export function readBlockVersionHandleSummary(
  versions: readonly BlockVersionSummaryCandidate[]
): BlockVersionHandleSummary {
  if (versions.length === 0) {
    return {
      hasHistory: false,
      versionCount: 0,
      latestVersionNumber: 0,
    };
  }

  return {
    hasHistory: true,
    versionCount: versions.length,
    latestVersionNumber: versions[0].version_number,
  };
}
