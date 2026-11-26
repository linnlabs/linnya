import {
  fitWorkspaceTable,
  isCompactTableCellElement,
  WORKSPACE_TABLE_CLASS,
  WORKSPACE_TABLE_COMPACT_CELL_CLASS,
} from '@linnya/markdown-document-core/workspace-table'
import { CHART_FIGURE_SELECTOR, readChartFigureSpec } from '../../../blocks/ChartBlock'
import { renderChartPrintImage } from '../../chart-reading'

export interface PrepareMarkdownHtmlForPdfOptions {
  /** 纸面正文栏宽度（CSS px）；给出时按它给表格定级，放不下的表格改为全部可换行，不会被页边裁掉。 */
  readonly tableWidthPx?: number
}

/** 表头行移进 thead，打印时跨页重复。 */
function moveHeaderRowToHead(table: HTMLTableElement): void {
  if (table.tHead) return
  const first = table.tBodies[0]?.rows[0]
  if (!first || first.cells.length === 0) return
  if (!Array.from(first.cells).every(cell => cell.tagName.toUpperCase() === 'TH')) return
  table.createTHead().append(first)
}

/** 短格判定与编辑器、只读预览同一规则；序列化 HTML 没有编辑器 decoration，这里按快照补上。 */
function markCompactCells(table: HTMLTableElement): void {
  for (const cell of Array.from(table.querySelectorAll('td, th'))) {
    if (isCompactTableCellElement(cell)) cell.classList.add(WORKSPACE_TABLE_COMPACT_CELL_CLASS)
  }
}

/**
 * 在当前页面的离屏舞台里按纸面宽度逐表测量；共用表格样式已随应用加载，测量与打印同一份 CSS。
 * 纸面不能横向滚动，收紧后仍放不下的表格降为 wrap，结果写回快照。
 */
function fitTablesToPage(snapshot: Document, tables: readonly HTMLTableElement[], widthPx: number): void {
  if (tables.length === 0 || widthPx <= 0) return
  const stage = document.createElement('div')
  stage.setAttribute('aria-hidden', 'true')
  stage.style.cssText = `position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;width:${widthPx}px;font-size:var(--editor-body-font-size, 16px);`
  document.body.append(stage)
  try {
    for (const table of tables) {
      const probe = document.importNode(table, true)
      stage.replaceChildren(probe)
      fitWorkspaceTable(probe, stage, { overflow: 'wrap' })
      table.replaceWith(snapshot.importNode(probe, true))
    }
  } finally {
    stage.remove()
  }
}

/**
 * 从序列化文档生成打印快照，不能克隆 NodeView：离屏图表可能根本没有挂载。
 * 任一图表失败则拒绝本次导出，不生成缺图的“成功”文件；原文档始终不变。
 */
export async function prepareMarkdownHtmlForPdf(
  editorHtml: string,
  options: PrepareMarkdownHtmlForPdfOptions = {},
): Promise<string> {
  const snapshot = new DOMParser().parseFromString(editorHtml, 'text/html')
  const figures = snapshot.querySelectorAll(CHART_FIGURE_SELECTOR)
  const tables = Array.from(snapshot.querySelectorAll<HTMLTableElement>(`table.${WORKSPACE_TABLE_CLASS}`))
  if (figures.length === 0 && tables.length === 0) return editorHtml

  for (const table of tables) {
    moveHeaderRowToHead(table)
    markCompactCells(table)
  }
  if (options.tableWidthPx !== undefined) fitTablesToPage(snapshot, tables, options.tableWidthPx)

  // 一次只保留一份 ECharts SSR 实例，长文档不同时创建全部图表运行时。
  for (const figure of figures) {
    const spec = readChartFigureSpec(figure)
    const { svg, width, height } = await renderChartPrintImage(spec)
    const image = snapshot.createElement('img')
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    image.width = width
    image.height = height
    image.alt = spec.title ?? ''
    // 图片已包含标题、说明、图例和脚注，不能再保留 figure 中的重复标题。
    figure.replaceChildren(image)
  }
  return snapshot.body.innerHTML
}
