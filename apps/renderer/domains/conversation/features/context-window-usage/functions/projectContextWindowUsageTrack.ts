import type {
  ContextWindowUsagePanelSegment,
  ContextWindowUsageTrackPresentation,
} from '../definitions/contextWindowUsagePanel';

/**
 * 总体已用宽度继续表达真实预算占比；颜色只在这段宽度内部重新分配。
 * 这样 CSS 可以给非零小段保留可见像素，而不会把整条用量画得更长。
 */
export function projectContextWindowUsageTrack(
  segments: readonly ContextWindowUsagePanelSegment[],
): ContextWindowUsageTrackPresentation {
  const totalShare = segments.reduce((sum, segment) => sum + segment.share, 0);
  const visibleSegments = segments.filter(segment => segment.share > 0);
  return {
    usedShare: Math.min(totalShare, 1),
    segments: visibleSegments.map(segment => ({
      ...segment,
      relativeShare: segment.share / totalShare,
    })),
  };
}
