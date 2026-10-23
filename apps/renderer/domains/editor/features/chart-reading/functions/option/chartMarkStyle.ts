/**
 * @file chartMarkStyle.ts
 * @description 标记的外观：填充 + 发丝描线的“柔彩”样式。
 *
 * 各图表类型的 option 构建函数只决定“画什么、画在哪”，标记长什么样（描线宽度、标记尺寸、渐变）集中在这里，
 * 这样换样式只改一个文件。颜色由 {@link ChartMarkColors} 给出：柱、扇区、面积用填充，折线、标记、轮廓用描线。
 */

import type { ChartMarkColors } from '../chartPalette'
import { withAlpha } from '../chartPalette'

export const MARK_STYLE = Object.freeze({
  /** 柱、扇区、散点的描线宽度。 */
  outlineWidth: 1,
  lineWidth: 1.75,
  markerSize: 6,
  /** 折线末点：实心描线色，比其余标记略大。 */
  endMarkerSize: 8,
  markerRingWidth: 1.5,
  /** 面积：填充色自上而下渐隐的两端不透明度。 */
  areaTopAlpha: 0.85,
  areaBottomAlpha: 0.04,
  /** 雷达图填充：系列多时更淡，避免叠成一团。 */
  radarFillAlpha: 0.4,
  radarFillAlphaCrowded: 0.28,
  radarCrowdedFrom: 3,
})

/** 填充 + 描线轮廓（柱、扇区、散点）。 */
export function outlinedMark(colors: ChartMarkColors, opacity: number) {
  return { color: colors.fill, borderColor: colors.ink, borderWidth: MARK_STYLE.outlineWidth, opacity }
}

/** 折线上的标记：填充色的圆点，描线色的环。 */
export function lineMarker(colors: ChartMarkColors, opacity: number) {
  return { color: colors.fill, borderColor: colors.ink, borderWidth: MARK_STYLE.markerRingWidth, opacity }
}

/** 折线末点：实心描线色，外圈用表面色，让它在线与网格之上独立可辨。 */
export function endMarker(colors: ChartMarkColors, surface: string, opacity: number) {
  return { color: colors.ink, borderColor: surface, borderWidth: MARK_STYLE.markerRingWidth, opacity }
}

/** 面积：填充色自上而下渐隐。被淡化的系列整体更淡。 */
export function areaGradient(fill: string, emphasized: boolean) {
  const scale = emphasized ? 1 : 0.35
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: withAlpha(fill, MARK_STYLE.areaTopAlpha * scale) },
      { offset: 1, color: withAlpha(fill, MARK_STYLE.areaBottomAlpha * scale) },
    ],
  }
}

export function radarFillAlpha(seriesCount: number): number {
  return seriesCount >= MARK_STYLE.radarCrowdedFrom ? MARK_STYLE.radarFillAlphaCrowded : MARK_STYLE.radarFillAlpha
}
