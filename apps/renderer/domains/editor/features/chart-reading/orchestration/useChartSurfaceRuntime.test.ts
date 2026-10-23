// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme'
import { chartFixture, chartTestTheme } from '../testing/chartTestFixtures'
import { useChartSurfaceRuntime } from './useChartSurfaceRuntime'
import { useChartReadingStore } from '../store/chartReadingStore'

const controller = vi.hoisted(() => ({
  render: vi.fn(async (_request: { theme: { palette: readonly { fill: string; ink: string }[] } }) => {}),
  dispose: vi.fn(),
  highlight: vi.fn(),
  isDisposed: false,
}))
vi.mock('./chartInstanceController', () => ({ createChartController: () => controller }))
vi.mock('../../../ui/useEditorLocalization', async () => {
  const { ref } = await import('vue')
  return { useEditorLocalization: () => ({ currentLocale: ref('zh-CN'), editorMessage: (key: string) => key }) }
})
vi.mock('@/app/notification', () => ({ useNotificationStore: () => ({ show: vi.fn() }) }))
vi.mock('./readChartTheme', async () => {
  const actual = await vi.importActual<typeof import('./readChartTheme')>('./readChartTheme')
  return { ...actual, resolveChartTheme: (_host: Element, scheme: 'light' | 'dark' = 'light', palette?: 'verdant' | 'warm' | 'aqua') => chartTestTheme(scheme, palette) }
})

const cleanups: (() => void)[] = []
let reducedMotion = false
const motionListeners = new Set<() => void>()
beforeEach(() => {
  setActivePinia(createPinia())
  controller.render.mockClear()
  reducedMotion = false
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reducedMotion }, addEventListener: (_: string, listener: () => void) => motionListeners.add(listener), removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener) }))
})
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  document.documentElement.removeAttribute(RENDERER_UI_THEME_ATTRIBUTE)
  vi.unstubAllGlobals()
})

async function settle() { await nextTick(); await nextTick(); await Promise.resolve() }
function mountChart(initial = chartFixture('line')) {
  const spec = shallowRef(initial)
  let runtime: ReturnType<typeof useChartSurfaceRuntime> | undefined
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(defineComponent({ setup() {
    const plotElement = ref<HTMLElement | null>(null)
    runtime = useChartSurfaceRuntime({ spec, readingKey: ref({ editorSessionId: 'editor-1', blockId: 'chart-1', variant: 'document' }), active: ref(true), plotElement })
    return () => h('div', { ref: plotElement })
  } }))
  app.mount(host)
  if (!runtime) throw new Error('runtime not mounted')
  let mounted = true
  const unmount = () => { if (mounted) { app.unmount(); host.remove(); mounted = false } }
  cleanups.push(unmount)
  return { spec, runtime, unmount }
}

it('离屏期间数据改变，重新挂载清理旧筛选；同一数据重挂载则保留', async () => {
  const first = mountChart()
  first.runtime.actions.toggleSeries('营收')
  await settle()
  first.unmount()
  const same = mountChart()
  expect(same.runtime.state.value.hiddenSeries).toContain('营收')
  same.unmount()
  const next = mountChart(chartFixture('line', { series: [{ name: '营收', values: [4, 3, 2, 1] }] }))
  expect(next.runtime.state.value.hiddenSeries).toEqual([])
  expect(useChartReadingStore().size()).toBe(0)
})

it('同属浅色的主题切换仍重绘；减少动态效果时禁止过渡', async () => {
  document.documentElement.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, 'light')
  const chart = mountChart()
  await settle()
  const before = controller.render.mock.calls.length
  document.documentElement.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, 'moonlight-blue')
  await settle()
  expect(controller.render.mock.calls.length).toBeGreaterThan(before)
  chart.runtime.actions.toggleSeries('营收')
  await settle()
  expect(controller.render).toHaveBeenLastCalledWith(expect.objectContaining({ transition: true }))
  reducedMotion = true
  motionListeners.forEach(listener => listener())
  await settle()
  chart.runtime.actions.reset()
  await settle()
  expect(controller.render).toHaveBeenLastCalledWith(expect.objectContaining({ transition: false }))
  chart.unmount()
  expect(motionListeners.size).toBe(0)
})

it('规格的 palette 决定图表主题和图例的色系，改变色系会重绘', async () => {
  const lastPalette = () => {
    const calls = controller.render.mock.calls
    return calls[calls.length - 1]?.[0].theme.palette
  }
  const chart = mountChart(chartFixture('line', { palette: 'warm' }))
  await settle()
  const warm = chartTestTheme('light', 'warm').palette
  expect(lastPalette()).toEqual(warm)
  expect(chart.runtime.legend.value.map(item => item.fill)).toEqual([warm[0]?.fill, warm[1]?.fill])

  chart.spec.value = chartFixture('line', { palette: 'aqua' })
  await settle()
  const aqua = chartTestTheme('light', 'aqua').palette
  expect(lastPalette()).toEqual(aqua)
  expect(chart.runtime.legend.value.map(item => item.fill)).toEqual([aqua[0]?.fill, aqua[1]?.fill])

  chart.spec.value = chartFixture('line')
  await settle()
  expect(lastPalette()).toEqual(chartTestTheme('light').palette)
})
