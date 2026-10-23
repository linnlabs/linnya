import { CHART_FIGURE_SELECTOR, readChartFigureSpec } from '../../../blocks/ChartBlock'
import { renderChartPrintImage } from '../../chart-reading'

/**
 * 从序列化文档生成打印快照，不能克隆 NodeView：离屏图表可能根本没有挂载。
 * 任一图表失败则拒绝本次导出，不生成缺图的“成功”文件；原文档始终不变。
 */
export async function prepareMarkdownHtmlForPdf(editorHtml: string): Promise<string> {
  const snapshot = new DOMParser().parseFromString(editorHtml, 'text/html')
  const figures = snapshot.querySelectorAll(CHART_FIGURE_SELECTOR)
  if (figures.length === 0) return editorHtml

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
