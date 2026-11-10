import type { RgbChannels } from '../definitions/color.js'
import { linearToSrgbChannel, srgbChannelToLinear } from './colorSpace.js'

export type ColorVisionDeficiency = 'protanopia' | 'deuteranopia' | 'tritanopia'

type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

/**
 * Machado、Oliveira、Fernandes 2009 生理模型在严重度 1.0（二色视）时的矩阵，作用在线性 sRGB 上。
 * 是最坏情况：多数色觉异常者是较轻的异常三色视。
 */
export const COLOR_VISION_DEFICIENCY_MATRICES: Readonly<Record<ColorVisionDeficiency, Matrix3>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

/** 模拟色觉异常者看到的颜色（0–255，可带小数）。 */
export function simulateColorVisionDeficiency(rgb: RgbChannels, kind: ColorVisionDeficiency): [number, number, number] {
  const matrix = COLOR_VISION_DEFICIENCY_MATRICES[kind]
  const linear = [srgbChannelToLinear(rgb[0]), srgbChannelToLinear(rgb[1]), srgbChannelToLinear(rgb[2])] as const
  const row = (index: 0 | 1 | 2) => matrix[index][0] * linear[0] + matrix[index][1] * linear[1] + matrix[index][2] * linear[2]
  return [linearToSrgbChannel(row(0)), linearToSrgbChannel(row(1)), linearToSrgbChannel(row(2))]
}
