/**
 * @file chartMarkStyle.ts
 * @description 正文图表的统一标记：原色无描边填充、清晰细线、轻面积，避免装饰遮盖数据。
 */

import type { ChartMarkColors } from '../chartPalette'
import { withAlpha } from '../chartPalette'

export const MARK_STYLE = Object.freeze({ lineWidth: 2, markerSize: 5 })

// 阅读悬停只用于查值，不自动放大、高亮或压淡其他数据；显式图例点击由阅读状态单独处理。
export const HOVER_EMPHASIS = Object.freeze({ disabled: true })

/** 柱、扇区与散点保留色板原色，不叠加深色轮廓。 */
export function filledMark(colors: ChartMarkColors, opacity: number) {
  return { color: colors.fill, borderWidth: 0, opacity }
}

/** 小观测点与折线共用可读线色，保持视觉上的连续性。 */
export function lineMarker(colors: ChartMarkColors, opacity: number) {
  return { color: colors.ink, borderWidth: 0, opacity }
}

/** 面积只辅助表达规模，低透明度平铺，不额外制造明暗梯度。 */
export function areaFill(fill: string, emphasized: boolean): string {
  return withAlpha(fill, emphasized ? 0.12 : 0.04)
}

export function radarFillAlpha(seriesCount: number): number {
  return seriesCount >= 3 ? 0.05 : 0.08
}
