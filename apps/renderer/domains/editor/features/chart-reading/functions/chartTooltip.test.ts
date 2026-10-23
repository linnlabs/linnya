// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { chartTestTheme } from '../testing/chartTestFixtures'
import { renderChartTooltip, type ChartTooltipContent } from './chartTooltip'

const content: ChartTooltipContent = {
  heading: 'Q2',
  rows: [
    { key: { fill: '#aabbcc', ink: '#112233', shape: 'bar' }, label: '营收', value: '132', detail: '占整体 38%' },
    { key: { fill: '#ddeeff', ink: '#334455', shape: 'line' }, label: '成本', value: '90' },
    { key: { fill: '#ffeedd', ink: '#554433', shape: 'dot' }, label: '样本', value: '5' },
  ],
}

function keys(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')]
}

describe('tooltip 渲染', () => {
  it('反色外观：深底浅字，随主题取 tooltipBackground / tooltipText，没有边框', () => {
    const light = renderChartTooltip(content, chartTestTheme('light'))
    const dark = renderChartTooltip(content, chartTestTheme('dark'))
    expect(light.style.color).toBe('rgb(255, 255, 255)')
    expect(light.style.background).toBe('rgb(64, 64, 64)')
    expect(dark.style.color).toBe('rgb(23, 23, 23)')
    expect(dark.style.background).toBe('rgb(237, 237, 237)')
    expect(light.style.border).toBe('')
  })

  it('图例键：柱与圆点是填充加描线轮廓，折线是描线色短线', () => {
    const [bar, line, dot] = keys(renderChartTooltip(content, chartTestTheme()))
    expect(bar?.style.background).toBe('rgb(170, 187, 204)')
    expect(bar?.style.border).toBe('1px solid rgb(17, 34, 51)')
    expect(line?.style.background).toBe('rgb(51, 68, 85)')
    expect(line?.style.border).toBe('')
    expect(dot?.style.borderRadius).toBe('50%')
    expect(dot?.style.border).toBe('1px solid rgb(85, 68, 51)')
  })

  it('数值用等宽数字并加粗，说明作为第三级文字独立成行', () => {
    const root = renderChartTooltip(content, chartTestTheme())
    const value = [...root.querySelectorAll<HTMLElement>('span')].find(element => element.textContent === '132')
    expect(value?.style.fontVariantNumeric).toBe('tabular-nums')
    expect(value?.style.fontWeight).toBe('600')
    expect([...root.children].some(child => child.textContent === '占整体 38%')).toBe(true)
  })

  it('标题、系列名、数值都是不可信文本：只写入 textContent，不会生成元素', () => {
    const hostile: ChartTooltipContent = {
      heading: '<img src=x onerror=alert(1)>',
      rows: [{ key: { fill: '#aabbcc', ink: '#112233', shape: 'bar' }, label: '<b>系列</b>', value: '<script>1</script>', detail: '<i>说明</i>' }],
    }
    const root = renderChartTooltip(hostile, chartTestTheme())
    expect(root.querySelector('img, b, i, script')).toBeNull()
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(root.textContent).toContain('<b>系列</b>')
  })
})
