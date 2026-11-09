/** 把任意角度归到 [0, 360)。 */
export function normalizeHue(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** 两个色相在色环上的最短距离，0–180°。 */
export function hueDistance(left: number, right: number): number {
  const difference = Math.abs(normalizeHue(left) - normalizeHue(right))
  return difference > 180 ? 360 - difference : difference
}

/** 从 `from` 顺时针到 `to` 的弧是否包含 `hue`（端点包含）；用于色相区间判断。 */
export function isHueWithinArc(hue: number, from: number, to: number): boolean {
  const span = normalizeHue(to - from)
  return normalizeHue(hue - from) <= span
}
