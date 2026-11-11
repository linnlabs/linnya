/** 把数值限制在 [min, max] 内。min 大于 max 时返回 min。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
