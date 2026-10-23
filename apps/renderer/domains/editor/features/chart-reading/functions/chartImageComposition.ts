/**
 * @file chartImageComposition.ts
 * @description 复制为图片时的整幅构图：标题、说明、图表、图例与量尺脚注。数字用等宽字形，刻度与数值上下对齐。
 *
 * 外部应用（文档、聊天、幻灯片）拿到的是一张自带语境的图，而不是缺少标题和图例的一块画布。
 * 构图是纯函数：文本测量由调用方注入，因此换行与高度可以确定性地测试。
 */

import type { MarkdownChartSpecReadView as ChartSpec } from '@app/schemas'
import type { ChartThemeTokens } from '../definitions/chartTheme'
import type { ChartLegendItem } from './chartLegend'

export type TextMeasurer = (text: string, fontSizePx: number, fontWeight: number) => number

export interface ChartImageCompositionInput {
  readonly spec: ChartSpec
  /** `renderToSVGString()` 的完整输出，尺寸为 `chartWidth × chartHeight`。 */
  readonly chartSvg: string
  readonly chartWidth: number
  readonly chartHeight: number
  readonly theme: ChartThemeTokens
  readonly legend: readonly ChartLegendItem[]
  /** 雷达等需要说明量尺的图表的脚注文字。 */
  readonly footnote?: string
  /** 组合图里位于次轴的系列在图例中的提示（如“右轴”），与界面图例一致。 */
  readonly secondaryAxisHint?: string
  readonly measure: TextMeasurer
}

export interface ChartImageComposition {
  readonly svg: string
  readonly width: number
  readonly height: number
}

const PADDING = 20
const TITLE_SIZE = 16
const BODY_SIZE = 13
const LINE_GAP = 6

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 按测得宽度贪心换行；单个字符超宽时也至少占一行，不会死循环。 */
export function wrapText(text: string, maxWidth: number, fontSize: number, fontWeight: number, measure: TextMeasurer): string[] {
  const lines: string[] = []
  let line = ''
  for (const character of text) {
    const candidate = line + character
    if (line !== '' && measure(candidate, fontSize, fontWeight) > maxWidth) {
      lines.push(line)
      line = character.trim() === '' ? '' : character
    } else {
      line = candidate
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

/** 图例键与界面一致：条形/圆点是无描边填充，线键直接用描线色。 */
function legendKey(item: ChartLegendItem, x: number, y: number): string {
  const fill = escapeXml(item.fill)
  const ink = escapeXml(item.ink)
  switch (item.shape) {
    case 'bar':
      return `<rect x="${x + 0.5}" y="${y - 4.5}" width="9" height="9" rx="2" fill="${fill}"/>`
    case 'dot':
      return `<circle cx="${x + 5}" cy="${y}" r="3.5" fill="${fill}"/>`
    default:
      return `<rect x="${x}" y="${y - 1.5}" width="14" height="3" rx="1.5" fill="${ink}"/>`
  }
}

export function composeChartImage(input: ChartImageCompositionInput): ChartImageComposition {
  const { spec, theme, measure } = input
  const width = input.chartWidth + PADDING * 2
  const innerWidth = input.chartWidth
  const parts: string[] = []
  let y = PADDING

  const textBlock = (text: string, size: number, weight: number, color: string) => {
    for (const line of wrapText(text, innerWidth, size, weight, measure)) {
      y += size
      parts.push(`<text x="${PADDING}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${escapeXml(color)}">${escapeXml(line)}</text>`)
      y += LINE_GAP
    }
  }

  if (spec.title) textBlock(spec.title, TITLE_SIZE, 600, theme.textPrimary)
  if (spec.description) textBlock(spec.description, BODY_SIZE, 400, theme.textSecondary)
  if (spec.title || spec.description) y += 6

  parts.push(`<g transform="translate(${PADDING} ${y})">${input.chartSvg}</g>`)
  y += input.chartHeight

  if (input.legend.length > 0) {
    y += 10
    let x = PADDING
    let rowTop = y
    y += BODY_SIZE + LINE_GAP
    for (const item of input.legend) {
      const label = item.secondaryAxis && input.secondaryAxisHint ? `${item.label} ${input.secondaryAxisHint}` : item.label
      const itemWidth = 20 + measure(label, BODY_SIZE, 400) + 18
      if (x > PADDING && x + itemWidth > PADDING + innerWidth) {
        x = PADDING
        rowTop = y
        y += BODY_SIZE + LINE_GAP + 4
      }
      const baseline = rowTop + BODY_SIZE
      parts.push(legendKey(item, x, baseline - 4))
      parts.push(`<text x="${x + 20}" y="${baseline}" font-size="${BODY_SIZE}" fill="${escapeXml(theme.textSecondary)}">${escapeXml(label)}</text>`)
      x += itemWidth
    }
  }

  if (input.footnote) {
    y += 6
    textBlock(input.footnote, 12, 400, theme.textMuted)
  }

  const height = y + PADDING
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`,
    ` font-family="${escapeXml(theme.fontFamily)}" style="font-variant-numeric:tabular-nums">`,
    `<rect width="${width}" height="${height}" fill="${escapeXml(theme.surface)}"/>`,
    ...parts,
    '</svg>',
  ].join('')
  return { svg, width, height }
}
