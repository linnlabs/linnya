// @vitest-environment jsdom
import { generateHTML } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MARKDOWN_CHART_TYPES, type MarkdownChartSpec } from '@app/schemas'
import { ChartBlockReadonly, chartFigureHtml } from '../../../blocks/ChartBlock'
import * as chartReading from '../../chart-reading'
import { chartFixture } from '../../chart-reading/testing/chartTestFixtures'
import { prepareMarkdownHtmlForPdf } from './prepareMarkdownHtmlForPdf'

function serializeCharts(specs: readonly MarkdownChartSpec[]): string {
  return generateHTML({
    type: 'doc',
    content: specs.map((spec, index) => ({ type: 'chartBlock', attrs: { id: `chart-${index}`, spec } })),
  }, [Document.extend({ content: 'chartBlock+' }), Text, ChartBlockReadonly])
}

function readImageSvg(image: HTMLImageElement): Document {
  const svg = decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1))
  return new DOMParser().parseFromString(svg, 'image/svg+xml')
}

beforeEach(() => {
  setActivePinia(createPinia())
  // jsdom 没有文字 canvas；SSR 使用既有测量降级，不打印无关的 canvas 提示。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

describe('Markdown PDF 内容投影', () => {
  it('正式 HTML 中没有 NodeView 图形时，八类图表仍完整输出为合法 SVG 图片', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const specs = MARKDOWN_CHART_TYPES.map(type => chartFixture(type, {
      title: `研究图表 ${type}`,
      description: '数据来源：演示样本 <非真实数据> & 对比',
    }))
    const original = serializeCharts(specs)
    expect(original).not.toContain('<svg')
    expect(original).not.toContain('<img')

    const printed = new DOMParser().parseFromString(await prepareMarkdownHtmlForPdf(original), 'text/html')
    const images = printed.querySelectorAll('img')
    expect(images).toHaveLength(specs.length)
    expect(printed.querySelector('figcaption')).toBeNull()
    images.forEach((image, index) => {
      const svg = readImageSvg(image)
      expect(svg.querySelector('parsererror')).toBeNull()
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
      expect(svg.documentElement.textContent).toContain(specs[index]?.title)
      expect(svg.documentElement.textContent).toContain('数据来源：演示样本 <非真实数据> & 对比')
      expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff')
    })
    const renderedText = new Map(MARKDOWN_CHART_TYPES.map((type, index) => [type, readImageSvg(images.item(index)).documentElement.textContent]))
    expect(renderedText.get('radar')).toContain('各维度共用同一量尺：0–100')
    expect(renderedText.get('combo')).toContain('利润率 右轴')
    // 打印只改快照，不把图片回写为图表的持久化内容。
    expect(original).toBe(serializeCharts(specs))
  })

  it('保留图表前后正文；非法规格拒绝整次导出', async () => {
    const text = '<h1>研究结果</h1><p>正文 &amp; 引用</p>'
    expect(await prepareMarkdownHtmlForPdf(text)).toBe(text)
    const html = `${text}${chartFigureHtml(document, chartFixture('bar'))}<p>结论</p>`
    const printed = new DOMParser().parseFromString(await prepareMarkdownHtmlForPdf(html), 'text/html')
    expect(printed.querySelector('h1')?.textContent).toBe('研究结果')
    expect(printed.body.lastElementChild?.textContent).toBe('结论')
    await expect(prepareMarkdownHtmlForPdf(`${html}<figure data-type="chart-block" data-chart-spec="{bad}"></figure>`))
      .rejects.toThrow('Invalid linnya-chart')
  })

  it('表格：表头行进 thead 跨页重复，短格与编辑器同一判定', async () => {
    const html = '<div class="root-block-outer"><div class="root-block"><table class="table-block" style="min-width: 100px">'
      + '<colgroup><col style="min-width: 50px"><col style="min-width: 50px"></colgroup><tbody>'
      + '<tr><th><div class="table-cell-content-block">阶段</div></th><th><div class="table-cell-content-block">说明</div></th></tr>'
      + '<tr><td><div class="table-cell-content-block">进行中</div></td>'
      + '<td><div class="table-cell-content-block">这一列是比较长的说明文字，需要在纸面上换行</div></td></tr>'
      + '</tbody></table></div></div>'
    const printed = new DOMParser().parseFromString(await prepareMarkdownHtmlForPdf(html), 'text/html')
    const table = printed.querySelector('table.table-block')
    expect(table?.querySelector('thead > tr')?.textContent).toBe('阶段说明')
    expect(table?.querySelectorAll('tbody > tr')).toHaveLength(1)
    const compact = Array.from(table?.querySelectorAll('.table-cell--compact') ?? []).map(cell => cell.textContent)
    expect(compact).toEqual(['阶段', '说明', '进行中'])
    expect(table?.hasAttribute('data-table-fit')).toBe(false)
  })

  it('表格放不下纸面时降为全部可换行，不被页边裁掉，用户选的表格样式随之打印', async () => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
    const html = '<table class="table-block" data-table-style="banded" style="width: 900px"><colgroup><col style="width: 900px"></colgroup><tbody>'
      + '<tr><td colwidth="900"><div class="table-cell-content-block">短</div></td></tr></tbody></table>'
    const printed = new DOMParser().parseFromString(
      await prepareMarkdownHtmlForPdf(html, { tableWidthPx: 600 }),
      'text/html',
    )
    const table = printed.querySelector<HTMLTableElement>('table.table-block')
    expect(table?.getAttribute('data-table-fit')).toBe('wrap')
    expect(table?.getAttribute('data-table-style')).toBe('banded')
    expect(table?.style.width).toBe('100%')
    expect(table?.querySelector('col')?.getAttribute('style') ?? '').not.toContain('900px')
    expect(table?.querySelector('.table-cell--compact')).toBeNull()
    // 测量舞台用完即移除。
    expect(document.body.children).toHaveLength(0)
  })

  it('绘图失败向调用方报告，不用仅有标题的 HTML 继续导出', async () => {
    const failure = new Error('SSR rendering failed')
    vi.spyOn(chartReading, 'renderChartPrintImage').mockRejectedValueOnce(failure)
    await expect(prepareMarkdownHtmlForPdf(serializeCharts([chartFixture('bar')])))
      .rejects.toBe(failure)
  })
})
