import { describe, expect, it } from 'vitest'
import { admitMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'
import { DEFAULT_CHART_READING_STATE } from '../definitions/chartReadingState'
import { deriveChartReadingView } from './chartReadingView'
import {
  isDefaultReadingState,
  normalizeReadingState,
  reconcileReadingState,
  setCategoryRange,
  setValueRanges,
  toggleEmphasis,
  toggleSeriesVisibility,
} from './chartReadingState'

function admit(input: Record<string, unknown>): MarkdownChartSpec {
  const result = admitMarkdownChartSpec(input)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.spec
}

const line = admit({
  chartType: 'line',
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [{ name: '营收', values: [1, 2, 3, 4] }, { name: '成本', values: [2, 2, 2, 2] }],
})
const pie = admit({ chartType: 'pie', categories: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2, 3] }] })
const scatter = admit({ chartType: 'scatter', categories: [1, 2, 3], series: [{ name: 'S', values: [1, 4, 9] }] })

describe('阅读状态的适用范围', () => {
  it('折线可以隐藏系列、突出系列、聚焦类目范围', () => {
    let state = toggleSeriesVisibility(line, DEFAULT_CHART_READING_STATE, '成本')
    expect(state.hiddenSeries).toEqual(['成本'])
    state = toggleEmphasis(line, state, '营收')
    expect(state.emphasis).toBe('营收')
    state = setCategoryRange(line, state, { start: 1, end: 2 })
    expect(state.categoryRange).toEqual({ start: 1, end: 2 })

    const view = deriveChartReadingView(line, state)
    expect(view.categoryIndices).toEqual([1, 2])
    expect(view.seriesVisible).toEqual([true, false])
    expect(view.isDefault).toBe(false)
  })

  it('再次选择同一对象取消突出；再次切换系列恢复显示', () => {
    let state = toggleEmphasis(line, DEFAULT_CHART_READING_STATE, '营收')
    state = toggleEmphasis(line, state, '营收')
    expect(state.emphasis).toBeNull()
    state = toggleSeriesVisibility(line, state, '成本')
    state = toggleSeriesVisibility(line, state, '成本')
    expect(isDefaultReadingState(state)).toBe(true)
  })

  it('隐藏被突出的系列时，突出同时取消', () => {
    let state = toggleEmphasis(line, DEFAULT_CHART_READING_STATE, '成本')
    state = toggleSeriesVisibility(line, state, '成本')
    expect(state.emphasis).toBeNull()
  })

  it('饼图只能突出组成部分，不能隐藏，也没有类目范围', () => {
    expect(toggleSeriesVisibility(pie, DEFAULT_CHART_READING_STATE, 's')).toBe(DEFAULT_CHART_READING_STATE)
    const emphasized = toggleEmphasis(pie, DEFAULT_CHART_READING_STATE, '1')
    expect(emphasized.emphasis).toBe('1')
    expect(setCategoryRange(pie, emphasized, { start: 0, end: 1 }).categoryRange).toBeNull()
    expect(deriveChartReadingView(pie, emphasized).categoryIndices).toEqual([0, 1, 2])
    expect(toggleEmphasis(pie, DEFAULT_CHART_READING_STATE, '9').emphasis).toBeNull()
  })

  it('散点支持 X/Y 范围，非法范围被忽略', () => {
    const state = setValueRanges(scatter, DEFAULT_CHART_READING_STATE, { xRange: { min: 1, max: 2 }, yRange: { min: 5, max: 5 } })
    expect(state.xRange).toEqual({ min: 1, max: 2 })
    expect(state.yRange).toBeNull()
    expect(setValueRanges(line, DEFAULT_CHART_READING_STATE, { xRange: { min: 1, max: 2 } }).xRange).toBeNull()
  })

  it('覆盖整个类目范围等于没有聚焦', () => {
    expect(setCategoryRange(line, DEFAULT_CHART_READING_STATE, { start: 0, end: 3 }).categoryRange).toBeNull()
    expect(setCategoryRange(line, DEFAULT_CHART_READING_STATE, { start: -4, end: 99 }).categoryRange).toBeNull()
  })
})

describe('阅读状态收敛与重置', () => {
  it('收敛时丢弃不存在的系列和越界范围', () => {
    const state = normalizeReadingState(line, {
      ...DEFAULT_CHART_READING_STATE,
      hiddenSeries: ['不存在', '成本'],
      categoryRange: { start: 2, end: 99 },
      emphasis: '不存在',
    })
    expect(state.hiddenSeries).toEqual(['成本'])
    expect(state.categoryRange).toEqual({ start: 2, end: 3 })
    expect(state.emphasis).toBeNull()
  })

  it('展示改动（标题、尺寸、颜色）保留有效状态', () => {
    const state = toggleSeriesVisibility(line, DEFAULT_CHART_READING_STATE, '成本')
    const restyled = admit({ ...line, title: '新标题', size: 'large', legendPosition: 'right' })
    expect(reconcileReadingState(line, restyled, state)).toBe(state)
  })

  it.each<[string, Record<string, unknown>]>([
    ['数值更新', { series: [{ name: '营收', values: [1, 2, 3, 5] }, { name: '成本', values: [2, 2, 2, 2] }] }],
    ['系列重命名', { series: [{ name: '收入', values: [1, 2, 3, 4] }, { name: '成本', values: [2, 2, 2, 2] }] }],
    ['类目变化', { categories: ['一', '二', '三', '四'] }],
    ['轴范围语义变化', { valueAxis: { min: 0, max: 10 } }],
  ])('%s 后回到默认视图', (_name, patch) => {
    const state = toggleSeriesVisibility(line, DEFAULT_CHART_READING_STATE, '成本')
    const next = admit({ ...line, ...patch })
    expect(reconcileReadingState(line, next, state)).toBe(DEFAULT_CHART_READING_STATE)
  })

  it('图表类型变化回到默认视图；首次装载没有上一份规格也是默认', () => {
    const state = toggleSeriesVisibility(line, DEFAULT_CHART_READING_STATE, '成本')
    const bar = admit({ ...line, chartType: 'bar' })
    expect(reconcileReadingState(line, bar, state)).toBe(DEFAULT_CHART_READING_STATE)
    expect(reconcileReadingState(null, line, state)).toBe(DEFAULT_CHART_READING_STATE)
  })
})
