/**
 * @file exportChartImage.ts
 * @description 默认视图的 PNG 导出：从当前规格受控渲染，不截取可能不存在的离屏 DOM。
 *
 * 同一份规格、主题和输出尺寸总得到同一张图：渲染使用 `intent: 'export'`（忽略阅读状态、无 tooltip、无动画），
 * 因此读者此前的筛选、聚焦或悬停都不影响结果。SSR SVG → 构图 → 栅格化，全程不触碰屏幕上的实例。
 */

import type { MarkdownChartSpecReadView } from '@app/schemas'
import { DEFAULT_CHART_READING_STATE } from '../definitions/chartReadingState'
import type { ChartOptionMessages } from '../definitions/chartRender'
import type { ChartThemeTokens } from '../definitions/chartTheme'
import { composeChartImage, type TextMeasurer } from '../functions/chartImageComposition'
import { buildChartLegend, resolveLegendPosition } from '../functions/chartLegend'
import { plotHeightOf } from '../functions/chartLayout'
import { buildChartOption } from '../functions/option/buildChartOption'
import { loadChartRuntime } from './chartRuntime'

export interface ChartImageRequest {
  readonly spec: MarkdownChartSpecReadView
  readonly theme: ChartThemeTokens
  readonly locale: string
  readonly messages: ChartOptionMessages
  /** 雷达量尺脚注等已本地化的说明。 */
  readonly footnote?: string
  /** 输出图宽（CSS px，含内边距）。 */
  readonly width?: number
  readonly pixelRatio?: number
}

export class ChartImageError extends Error {
  readonly code = 'CHART_IMAGE_FAILED'
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ChartImageError'
    this.cause = cause
  }
}

const DEFAULT_WIDTH = 720
const PADDING = 20

function createMeasurer(fontFamily: string): TextMeasurer {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
  const context = canvas?.getContext('2d') ?? null
  return (text, size, weight) => {
    if (context) {
      context.font = `${weight} ${size}px ${fontFamily}`
      return context.measureText(text).width
    }
    // 没有 canvas 时按字形粗估：CJK 全宽，其余约 0.56em。
    return [...text].reduce((sum, character) => sum + (character.charCodeAt(0) > 0x2e80 ? size : size * 0.56), 0)
  }
}

export async function renderChartImageSvg(request: ChartImageRequest): Promise<{ svg: string; width: number; height: number }> {
  const { spec } = request
  const totalWidth = request.width ?? DEFAULT_WIDTH
  const chartWidth = totalWidth - PADDING * 2
  const chartHeight = plotHeightOf(spec)

  const echarts = await loadChartRuntime(spec.chartType)
  const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: chartWidth, height: chartHeight })
  try {
    chart.setOption(buildChartOption(spec, DEFAULT_CHART_READING_STATE, {
      theme: request.theme,
      locale: request.locale,
      messages: request.messages,
      plotWidth: chartWidth,
      plotHeight: chartHeight,
      intent: 'export',
      transition: false,
    }))
    const chartSvg = chart.renderToSVGString()
    const legend = resolveLegendPosition(spec) === 'none'
      ? []
      : buildChartLegend(spec, DEFAULT_CHART_READING_STATE, request.theme)
    return composeChartImage({
      spec,
      chartSvg,
      chartWidth,
      chartHeight,
      theme: request.theme,
      legend,
      ...(request.footnote ? { footnote: request.footnote } : {}),
      secondaryAxisHint: request.messages.secondaryAxis,
      measure: createMeasurer(request.theme.fontFamily),
    })
  } finally {
    chart.dispose()
  }
}

async function rasterize(svg: string, width: number, height: number, pixelRatio: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    const context = canvas.getContext('2d')
    if (!context) throw new ChartImageError('Canvas 2D is unavailable')
    context.scale(pixelRatio, pixelRatio)
    context.drawImage(image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new ChartImageError('PNG encoding failed'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 渲染默认视图 PNG；任何一步失败都抛出 {@link ChartImageError}，由调用方单独报告。 */
export async function renderChartImagePng(request: ChartImageRequest): Promise<Blob> {
  try {
    const { svg, width, height } = await renderChartImageSvg(request)
    return await rasterize(svg, width, height, request.pixelRatio ?? 2)
  } catch (error) {
    if (error instanceof ChartImageError) throw error
    throw new ChartImageError('Chart image rendering failed', error)
  }
}
