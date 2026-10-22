/**
 * @file chartValueRangeDraft.ts
 * @description 散点 X/Y 范围输入的草稿规则：把“正在输入的两段文字”解释成可提交的范围。
 *
 * 数字输入是受控的，输入中的中间态（空、`-`、`1.`）不能直接当作范围提交，否则每次按键都会
 * 改写读者看到的图。这里只做纯解释：何时提交、何时清除、何时继续等待。
 */

import type { ChartValueRange } from '../definitions/chartReadingState'

export interface ChartValueRangeDraft {
  readonly min: string
  readonly max: string
}

export type ChartValueRangeDraftResolution =
  | { readonly kind: 'clear' }
  | { readonly kind: 'range'; readonly range: ChartValueRange }
  /** 一端为空或还不是数：继续等待输入，不改变图。 */
  | { readonly kind: 'pending' }
  /** 两端都是数但下界不小于上界：提示读者，不提交。 */
  | { readonly kind: 'invalid' }

export const EMPTY_CHART_VALUE_RANGE_DRAFT: ChartValueRangeDraft = Object.freeze({ min: '', max: '' })

export function draftOfRange(range: ChartValueRange | null): ChartValueRangeDraft {
  return range === null ? EMPTY_CHART_VALUE_RANGE_DRAFT : { min: String(range.min), max: String(range.max) }
}

function parseDraftNumber(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export function resolveValueRangeDraft(draft: ChartValueRangeDraft): ChartValueRangeDraftResolution {
  const minBlank = draft.min.trim() === ''
  const maxBlank = draft.max.trim() === ''
  if (minBlank && maxBlank) return { kind: 'clear' }
  const min = parseDraftNumber(draft.min)
  const max = parseDraftNumber(draft.max)
  if (min === null || max === null) return { kind: 'pending' }
  return min < max ? { kind: 'range', range: { min, max } } : { kind: 'invalid' }
}

/** 草稿表达的范围是否就是当前状态：数值相等即可，`1.50` 与 `1.5` 视为同一个范围。 */
export function draftMatchesRange(draft: ChartValueRangeDraft, range: ChartValueRange | null): boolean {
  const resolution = resolveValueRangeDraft(draft)
  if (resolution.kind === 'clear') return range === null
  if (resolution.kind !== 'range') return false
  return range !== null && range.min === resolution.range.min && range.max === resolution.range.max
}

/**
 * 数字输入组件回传的是解析后的数；若它与当前草稿文字数值相同，就保留读者正在输入的原文
 * （`1.`、`1.50`），避免受控回写把输入中的小数点吞掉。
 */
export function nextDraftText(currentText: string, emitted: number | string): string {
  if (typeof emitted === 'number' && parseDraftNumber(currentText) === emitted) return currentText
  return String(emitted)
}
