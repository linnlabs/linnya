/**
 * 让目标区间完整进入视口所需的最小滚动；已经可见时返回 null，避免点击可见项时列表跳动。
 * start/end 与 scrollOffset 处于同一滚动内容坐标系，inset 为两端保留的呼吸空间。
 */
export function resolveNearestScrollOffset(input: {
  readonly start: number;
  readonly end: number;
  readonly scrollOffset: number;
  readonly viewportSize: number;
  readonly inset: number;
}): number | null {
  const visibleStart = input.scrollOffset + input.inset;
  const visibleEnd = input.scrollOffset + input.viewportSize - input.inset;
  if (input.start >= visibleStart && input.end <= visibleEnd) return null;
  const target = input.start < visibleStart || input.end - input.start > visibleEnd - visibleStart
    ? input.start - input.inset
    : input.end - input.viewportSize + input.inset;
  const clamped = Math.max(0, target);
  return clamped === input.scrollOffset ? null : clamped;
}
