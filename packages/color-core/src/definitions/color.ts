/** 0–255 的 sRGB 通道；运算结果可以带小数，输出 hex 时才取整。 */
export type RgbChannels = readonly [number, number, number]

export interface ParsedColor {
  readonly channels: RgbChannels
  /** 0–1。 */
  readonly alpha: number
}

export interface Oklab {
  /** 明度，0（黑）– 1（白）。 */
  readonly l: number
  readonly a: number
  readonly b: number
}

export interface Oklch {
  /** 明度，0（黑）– 1（白）。 */
  readonly l: number
  /** 彩度，0 为灰；sRGB 内最大约 0.32。 */
  readonly c: number
  /** 色相角，0–360°。 */
  readonly h: number
}
