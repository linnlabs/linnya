import { describe, expect, it } from 'vitest'
import {
  draftMatchesRange,
  draftOfRange,
  EMPTY_CHART_VALUE_RANGE_DRAFT,
  nextDraftText,
  resolveValueRangeDraft,
} from './chartValueRangeDraft'

describe('resolveValueRangeDraft', () => {
  it('两端都空表示清除范围', () => {
    expect(resolveValueRangeDraft(EMPTY_CHART_VALUE_RANGE_DRAFT)).toEqual({ kind: 'clear' })
    expect(resolveValueRangeDraft({ min: '  ', max: '' })).toEqual({ kind: 'clear' })
  })

  it('两端都是合法数且下界小于上界才提交', () => {
    expect(resolveValueRangeDraft({ min: '1.5', max: '10' })).toEqual({ kind: 'range', range: { min: 1.5, max: 10 } })
    expect(resolveValueRangeDraft({ min: '-3', max: '-1' })).toEqual({ kind: 'range', range: { min: -3, max: -1 } })
  })

  it('只填一端或还不是数时继续等待', () => {
    expect(resolveValueRangeDraft({ min: '1', max: '' })).toEqual({ kind: 'pending' })
    expect(resolveValueRangeDraft({ min: '', max: '4' })).toEqual({ kind: 'pending' })
    expect(resolveValueRangeDraft({ min: '-', max: '4' })).toEqual({ kind: 'pending' })
    expect(resolveValueRangeDraft({ min: 'abc', max: '4' })).toEqual({ kind: 'pending' })
    expect(resolveValueRangeDraft({ min: 'Infinity', max: '4' })).toEqual({ kind: 'pending' })
  })

  it('下界不小于上界时报告无效而不提交', () => {
    expect(resolveValueRangeDraft({ min: '5', max: '5' })).toEqual({ kind: 'invalid' })
    expect(resolveValueRangeDraft({ min: '6', max: '5' })).toEqual({ kind: 'invalid' })
  })
})

describe('draftOfRange / draftMatchesRange', () => {
  it('范围与草稿互相对应', () => {
    expect(draftOfRange(null)).toEqual({ min: '', max: '' })
    expect(draftOfRange({ min: 1.5, max: 10 })).toEqual({ min: '1.5', max: '10' })
  })

  it('数值相等即视为同一范围，不要求文字相同', () => {
    expect(draftMatchesRange({ min: '1.50', max: '10.0' }, { min: 1.5, max: 10 })).toBe(true)
    expect(draftMatchesRange({ min: '1.5', max: '11' }, { min: 1.5, max: 10 })).toBe(false)
    expect(draftMatchesRange(EMPTY_CHART_VALUE_RANGE_DRAFT, null)).toBe(true)
    expect(draftMatchesRange({ min: '1', max: '' }, null)).toBe(false)
    expect(draftMatchesRange(EMPTY_CHART_VALUE_RANGE_DRAFT, { min: 1, max: 2 })).toBe(false)
  })
})

describe('nextDraftText', () => {
  it('回传的数与当前文字数值相同时保留读者输入的原文', () => {
    expect(nextDraftText('1.', 1)).toBe('1.')
    expect(nextDraftText('1.50', 1.5)).toBe('1.50')
    expect(nextDraftText('-0', 0)).toBe('-0')
  })

  it('数值变化或回传原始文字时采用新值', () => {
    expect(nextDraftText('1', 1.5)).toBe('1.5')
    expect(nextDraftText('1', '')).toBe('')
    expect(nextDraftText('', 3)).toBe('3')
  })
})
