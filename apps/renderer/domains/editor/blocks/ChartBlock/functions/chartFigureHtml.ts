/**
 * @file chartFigureHtml.ts
 * @description 图表块的 HTML 往返：`<figure data-type="chart-block" data-chart-spec="…">`。
 *
 * - Editor 内部序列化（拖拽/复制回退）只带标题与 canonical 规格；
 * - 对外剪贴板额外带一张数据表，外部应用至少能拿到数据；
 * - 解析时只信任 `data-chart-spec`，并走与 Markdown 导入相同的严格准入：非法规格整体拒绝，
 *   不会留下半个图表，也不会把 figure 里的表格当成普通表格误粘进文档。
 */

import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model'
import {
  admitMarkdownChartFenceBody,
  serializeMarkdownChartSpec,
  MarkdownChartSpecInvalidError,
  type MarkdownChartSpec,
} from '@app/schemas'
import type { ChartDataTableModel } from '../../../features/chart-reading'

export const CHART_FIGURE_TYPE = 'chart-block'
export const CHART_FIGURE_SELECTOR = `figure[data-type="${CHART_FIGURE_TYPE}"]`
const SPEC_ATTRIBUTE = 'data-chart-spec'

export interface ChartFigureOptions {
  readonly id?: string | null
  readonly blockType?: string
  /** 仅对外剪贴板使用：把数据表一并写进 figure。 */
  readonly table?: ChartDataTableModel
}

function tableSpec(table: ChartDataTableModel): DOMOutputSpec {
  return [
    'table',
    ['thead', ['tr', ...table.header.map((cell): DOMOutputSpec => ['th', cell])]],
    ['tbody', ...table.rows.map((row): DOMOutputSpec => [
      'tr',
      ...row.map((cell, index): DOMOutputSpec => (index === 0 ? ['th', { scope: 'row' }, cell] : ['td', cell])),
    ])],
  ]
}

/** `<figure>` 的 DOM 描述：固定的标签与属性表，后面是子节点。 */
export type ChartFigureDomSpec = readonly ['figure', Record<string, string>, ...DOMOutputSpec[]]

export function chartFigureDomSpec(spec: MarkdownChartSpec, options: ChartFigureOptions = {}): ChartFigureDomSpec {
  const attributes: Record<string, string> = {
    'data-type': CHART_FIGURE_TYPE,
    'data-block-type': options.blockType ?? 'chart',
    [SPEC_ATTRIBUTE]: serializeMarkdownChartSpec(spec),
  }
  if (options.id) attributes['data-id'] = options.id

  const children: DOMOutputSpec[] = []
  if (options.table) children.push(tableSpec(options.table))
  if (spec.title || spec.description) {
    const caption: DOMOutputSpec[] = []
    if (spec.title) caption.push(['div', { class: 'figure-caption__title' }, spec.title])
    if (spec.description) caption.push(['div', { class: 'figure-caption__description' }, spec.description])
    children.push(['figcaption', { class: 'figure-caption' }, ...caption])
  }
  return ['figure', attributes, ...children]
}

/** 渲染成 HTML 字符串，供剪贴板的语义化 HTML 使用。 */
export function chartFigureHtml(ownerDocument: Document, spec: MarkdownChartSpec, options: ChartFigureOptions = {}): string {
  const { dom } = DOMSerializer.renderSpec(ownerDocument, chartFigureDomSpec(spec, options))
  return dom instanceof Element ? dom.outerHTML : ''
}

export interface ParsedChartFigure {
  readonly spec: MarkdownChartSpec
  readonly id: string | null
}

/** 已识别的图表 figure 只从正式属性读取规格，打印和 HTML 往返共用严格准入。 */
export function readChartFigureSpec(element: Element): MarkdownChartSpec {
  const admission = admitMarkdownChartFenceBody(element.getAttribute(SPEC_ATTRIBUTE) ?? '')
  if (!admission.ok) throw new MarkdownChartSpecInvalidError(admission.diagnostics)
  return admission.spec
}

/** 非图表返回 null；图表规格无效则拒绝整次解析，禁止静默丢弃。 */
export function readChartFigure(element: Element): ParsedChartFigure | null {
  if (!element.matches(CHART_FIGURE_SELECTOR)) return null
  return { spec: readChartFigureSpec(element), id: element.getAttribute('data-id') }
}
