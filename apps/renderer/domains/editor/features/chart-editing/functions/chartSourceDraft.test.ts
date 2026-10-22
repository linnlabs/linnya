import { describe, expect, it } from 'vitest'
import { evaluateChartSource, isChartSourceChanged, sourceTextOfSpec } from './chartSourceDraft'

const validSource = JSON.stringify({
  chartType: 'bar',
  categories: ['A', 'B'],
  series: [{ name: 'S', values: [1, 2] }],
})

describe('evaluateChartSource', () => {
  it('空白草稿不是错误，只是还没有内容', () => {
    expect(evaluateChartSource('')).toEqual({ kind: 'empty' })
    expect(evaluateChartSource('  \n ')).toEqual({ kind: 'empty' })
  })

  it('有效草稿返回准入后的规格与 canonical 文本', () => {
    const result = evaluateChartSource(validSource)
    if (result.kind !== 'valid') throw new Error('应当有效')
    expect(result.spec.chartType).toBe('bar')
    expect(result.canonicalText).toContain('"chartType": "bar"')
  })

  it('JSON 语法错误给出位置', () => {
    const result = evaluateChartSource('{"chartType": "bar",')
    if (result.kind !== 'invalid') throw new Error('应当无效')
    expect(result.diagnostics[0]?.code).toBe('invalid_json')
  })

  it('字段规则违反给出可修复的诊断，且不静默丢弃不适用字段', () => {
    const result = evaluateChartSource(JSON.stringify({
      chartType: 'pie',
      categories: ['A', 'B'],
      series: [{ name: 'S', values: [1, 2], lineDash: 'dash' }],
    }))
    if (result.kind !== 'invalid') throw new Error('应当无效')
    expect(result.diagnostics.map(item => item.path)).toContain('series[0].lineDash')
  })

  it('切换类型后重新校验：残留的不适用字段被报告', () => {
    const result = evaluateChartSource(JSON.stringify({
      chartType: 'radar',
      categories: ['a', 'b', 'c'],
      series: [{ name: 'S', values: [1, 2, 3] }],
      stacking: 'stacked',
      radarScale: { min: 0, max: 5 },
    }))
    if (result.kind !== 'invalid') throw new Error('应当无效')
    expect(result.diagnostics.some(item => item.path === 'stacking')).toBe(true)
  })
})

describe('isChartSourceChanged', () => {
  it('canonical 相同（空白、键序不同）不算改动', () => {
    const evaluation = evaluateChartSource(validSource)
    if (evaluation.kind !== 'valid') throw new Error('应当有效')
    const reordered = JSON.stringify({
      series: [{ values: [1, 2], name: 'S' }],
      categories: ['A', 'B'],
      chartType: 'bar',
    }, null, 4)
    const reorderedEvaluation = evaluateChartSource(reordered)
    expect(isChartSourceChanged(reorderedEvaluation, evaluation.canonicalText)).toBe(false)
  })

  it('数据变化算改动；无效草稿一律视为改动', () => {
    const evaluation = evaluateChartSource(validSource)
    if (evaluation.kind !== 'valid') throw new Error('应当有效')
    const edited = evaluateChartSource(validSource.replace('[1,2]', '[1,3]'))
    expect(isChartSourceChanged(edited, evaluation.canonicalText)).toBe(true)
    expect(isChartSourceChanged(evaluateChartSource('{'), evaluation.canonicalText)).toBe(true)
  })

  it('面板初始源码就是规格的 canonical 文本', () => {
    const evaluation = evaluateChartSource(validSource)
    if (evaluation.kind !== 'valid') throw new Error('应当有效')
    expect(sourceTextOfSpec(evaluation.spec)).toBe(evaluation.canonicalText)
  })
})
