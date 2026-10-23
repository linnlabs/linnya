// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHART_READING_STATE } from '../definitions/chartReadingState'
import { chartFixture, chartTestTheme } from '../testing/chartTestFixtures'
import { createChartController, getLiveChartInstanceCount, type ChartControllerInput } from './chartInstanceController'

const messages = { secondaryAxis: '右轴', shareOfWhole: '占整体', share: '占比' }

function input(type: Parameters<typeof chartFixture>[0] = 'line', patch: Record<string, unknown> = {}, transition = false): ChartControllerInput {
  return { spec: chartFixture(type, patch), state: DEFAULT_CHART_READING_STATE, theme: chartTestTheme(), locale: 'zh-CN', messages, transition }
}

const hosts: HTMLElement[] = []
function createHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

// jsdom 没有 canvas：ECharts 每次测量文字都会探测 getContext，jsdom 为此逐次打印 "Not implemented"。
// 明确返回 null，让 zrender 走自带的估算路径；行为与未打桩时相同，输出保持干净。
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterAll(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  hosts.splice(0).forEach(host => host.remove())
})

describe('ChartController 生命周期', () => {
  it('渲染创建一个实例，释放后实例计数回落；重复释放无副作用', async () => {
    const before = getLiveChartInstanceCount()
    const host = createHost()
    const controller = createChartController(host)
    await controller.render(input())
    expect(getLiveChartInstanceCount()).toBe(before + 1)
    expect(host.querySelector('svg')).not.toBeNull()

    controller.dispose()
    controller.dispose()
    expect(getLiveChartInstanceCount()).toBe(before)
    expect(controller.isDisposed).toBe(true)
  })

  it('同一实例上更新：数值变化会反映到 SVG；删除系列后不留下旧系列', async () => {
    const host = createHost()
    const controller = createChartController(host)
    await controller.render(input('line'))
    const initialPaths = host.querySelectorAll('path').length

    await controller.render(input('line', { series: [{ name: '营收', values: [1, 2, 3, 4] }] }))
    expect(getLiveChartInstanceCount()).toBeGreaterThan(0)
    expect(host.querySelectorAll('path').length).toBeLessThan(initialPaths)
    controller.dispose()
  })

  it('图表类型变化时整体替换（折线 → 饼），不残留坐标轴，且不泄漏实例', async () => {
    const liveBefore = getLiveChartInstanceCount()
    const host = createHost()
    const controller = createChartController(host)
    await controller.render(input('line'))
    await controller.render(input('pie'))
    // 容器宽度为 0 的测试环境按最小绘图宽度渲染，避碰可能隐藏部分标签；这里只断言旧图表已被整体替换。
    expect(host.textContent).toContain('其他')
    expect(host.textContent).not.toContain('Q1')
    expect(getLiveChartInstanceCount()).toBe(liveBefore + 1)
    controller.dispose()
    expect(getLiveChartInstanceCount()).toBe(liveBefore)
  })

  it('释放发生在运行时加载期间：旧结果不会重新挂回，也不产生实例', async () => {
    const before = getLiveChartInstanceCount()
    const host = createHost()
    const controller = createChartController(host)
    const pending = controller.render(input('scatter'))
    controller.dispose()
    await pending
    expect(getLiveChartInstanceCount()).toBe(before)
    expect(host.querySelector('svg')).toBeNull()
  })

  it('快速连续更新：以最新规格为准，不积压', async () => {
    const host = createHost()
    const controller = createChartController(host)
    const first = controller.render(input('line', { title: '旧' }))
    const second = controller.render(input('line', { series: [{ name: '最新系列', values: [1, 2, 3, 4] }] }))
    await Promise.all([first, second])
    expect(host.textContent).toContain('Q1')
    controller.dispose()
  })

  it('高亮与取消高亮不抛错；释放后调用无副作用', async () => {
    const host = createHost()
    const controller = createChartController(host)
    await controller.render(input('line'))
    expect(() => {
      controller.highlight({ kind: 'series', name: '营收' })
      controller.highlight(null)
    }).not.toThrow()
    controller.dispose()
    expect(() => controller.highlight({ kind: 'series', name: '营收' })).not.toThrow()
  })
})

it('清除轴标题、堆叠和线型后，真实 ECharts 不残留旧属性', async () => {
  const host = createHost()
  host.setAttribute('role', 'img')
  host.setAttribute('aria-label', '柱状图 · 研究对比')
  const controller = createChartController(host)
  await controller.render(input('bar', { stacking: 'stacked', valueAxis: { title: '旧单位' } }))
  expect(host.textContent).toContain('旧单位')
  // 自动描述曾覆盖宿主标题，并把堆叠的内部维度和 NaN 暴露给读屏用户。
  expect(host.getAttribute('aria-label')).toBe('柱状图 · 研究对比')
  await controller.render(input('bar'))
  expect(host.textContent).not.toContain('旧单位')
  const { getInstanceByDom } = await import('echarts/core')
  const instance = getInstanceByDom(host)
  const option = instance?.getOption()
  const series: unknown = option?.['series']
  expect(series).toEqual(expect.arrayContaining([expect.objectContaining({ stack: '' })]))
  controller.dispose()
})
