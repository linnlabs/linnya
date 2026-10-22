import { describe, expect, it } from 'vitest'
import { normalizeCodeBlockLanguage } from './codeBlockLanguage'

describe('normalizeCodeBlockLanguage', () => {
  it('普通语言原样保留', () => {
    expect(normalizeCodeBlockLanguage('typescript')).toBe('typescript')
    expect(normalizeCodeBlockLanguage('chart')).toBe('chart')
    expect(normalizeCodeBlockLanguage('echarts')).toBe('echarts')
    expect(normalizeCodeBlockLanguage('json')).toBe('json')
  })

  it('空值统一为 null', () => {
    expect(normalizeCodeBlockLanguage(null)).toBeNull()
    expect(normalizeCodeBlockLanguage(undefined)).toBeNull()
    expect(normalizeCodeBlockLanguage('')).toBeNull()
  })

  it('图表专属语言规整为 json，不丢内容也不保留专属语言', () => {
    expect(normalizeCodeBlockLanguage('linnya-chart')).toBe('json')
  })
})
