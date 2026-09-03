export interface OptionLabelMarqueeMetrics {
  readonly distancePx: number;
  readonly durationMs: number;
}

const SCROLL_SPEED_PX_PER_SECOND = 36;
const MIN_DURATION_MS = 1_800;
const MAX_DURATION_MS = 8_000;

/** 只为真实溢出的标签计算滚动距离，滚动速度随文本长度保持稳定。 */
export function resolveOptionLabelMarquee(
  scrollWidth: number,
  clientWidth: number
): OptionLabelMarqueeMetrics | null {
  const distancePx = Math.ceil(scrollWidth - clientWidth);
  if (distancePx <= 0) return null;

  return {
    distancePx,
    durationMs: Math.min(
      MAX_DURATION_MS,
      Math.max(MIN_DURATION_MS, Math.round((distancePx / SCROLL_SPEED_PX_PER_SECOND) * 1_000))
    ),
  };
}
