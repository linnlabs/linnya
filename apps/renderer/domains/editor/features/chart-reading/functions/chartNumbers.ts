/**
 * @file chartNumbers.ts
 * @description 图表数值的纯函数：刻度域、浮点清理与展示格式。
 *
 * 数值轴域由完整数据确定性地计算后显式交给绘图库，而不是让绘图库按“当前可见数据”自动拟合：
 * 读者隐藏系列或聚焦类目范围时，轴域和单位保持不变，不会因为缩放制造相关性。
 */

import { formatChartValue } from '@app/schemas'

export interface NiceScale {
  readonly min: number
  readonly max: number
  readonly interval: number
}

/** 清理 0.1+0.2 一类的浮点噪声，同时把 -0 归为 0。 */
export function cleanFloat(value: number): number {
  if (!Number.isFinite(value)) return value
  const cleaned = Number(value.toPrecision(12))
  return Object.is(cleaned, -0) ? 0 : cleaned
}

function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  const nice = round
    ? (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10)
    : (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10)
  return nice * 10 ** exponent
}

function widenDegenerate(min: number, max: number): { min: number; max: number } {
  if (min !== max) return { min, max }
  if (min === 0) return { min: 0, max: 1 }
  const pad = Math.abs(min) * 0.1
  return { min: min - pad, max: max + pad }
}

/** 以“约 targetTicks 个刻度”为目标，计算落在整齐刻度上的轴域。 */
export function computeNiceScale(min: number, max: number, targetTicks: number): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RangeError(`Invalid scale extent: ${min}..${max}`)
  }
  const extent = widenDegenerate(min, max)
  const range = niceNumber(extent.max - extent.min, false)
  const interval = niceNumber(range / (Math.max(2, targetTicks) - 1), true)
  return {
    min: cleanFloat(Math.floor(extent.min / interval + 1e-9) * interval),
    max: cleanFloat(Math.ceil(extent.max / interval - 1e-9) * interval),
    interval: cleanFloat(interval),
  }
}

export interface ResolveAxisDomainInput {
  readonly dataMin: number
  readonly dataMax: number
  /** 柱、面积的基线必须是零。 */
  readonly includeZero: boolean
  /** 数据两侧留白的比例，用于散点避免边缘点被裁切。 */
  readonly padRatio?: number
  readonly userMin?: number
  readonly userMax?: number
  readonly majorUnit?: number
  readonly targetTicks: number
}

/** 作者显式给出的范围/主刻度优先；其余由完整数据确定。 */
export function resolveAxisDomain(input: ResolveAxisDomainInput): NiceScale {
  let low = input.dataMin
  let high = input.dataMax
  if (input.includeZero) {
    low = Math.min(low, 0)
    high = Math.max(high, 0)
  }
  if (input.padRatio && high > low) {
    const pad = (high - low) * input.padRatio
    if (!(input.includeZero && low === 0)) low -= pad
    if (!(input.includeZero && high === 0)) high += pad
  }

  // 单边范围可能排除全部观测；自动端仍须位于作者边界的另一侧，不能生成反向或零宽轴。
  if (input.userMin !== undefined) low = input.userMin
  if (input.userMax !== undefined) high = input.userMax
  if (low > high) {
    if (input.userMin !== undefined && input.userMax === undefined) high = low
    else if (input.userMax !== undefined && input.userMin === undefined) low = high
  }
  const auto = computeNiceScale(low, high, input.targetTicks)
  const interval = input.majorUnit ?? auto.interval
  let min = input.userMin ?? (input.majorUnit
    ? cleanFloat(Math.floor(low / interval + 1e-9) * interval)
    : auto.min)
  let max = input.userMax ?? (input.majorUnit
    ? cleanFloat(Math.ceil(high / interval - 1e-9) * interval)
    : auto.max)
  if (min >= max) {
    if (input.userMin === undefined) min = cleanFloat(max - interval)
    else if (input.userMax === undefined) max = cleanFloat(min + interval)
  }
  // 作者给了两端但没给主刻度：按给定范围重新选取整齐的间隔。
  if (input.userMin !== undefined && input.userMax !== undefined && input.majorUnit === undefined) {
    return { min, max, interval: computeNiceScale(min, max, input.targetTicks).interval }
  }
  return { min, max, interval }
}

/**
 * 让次轴的刻度间隔数与主轴一致，使主轴网格线与次轴刻度对齐。
 * 只在对齐后数据仍占据足够比例时采用（否则返回 null，由调用方使用独立的整齐刻度）：
 * 为对齐而把数据压扁成一小段，比刻度错位更糟。
 */
export function alignScaleToIntervals(
  min: number,
  max: number,
  intervals: number,
  options: { readonly includeZero: boolean },
): NiceScale | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || intervals < 1) return null
  const low = options.includeZero ? Math.min(0, min) : min
  const high = options.includeZero ? Math.max(0, max) : max
  const extent = widenDegenerate(low, high)
  const exponent = Math.floor(Math.log10((extent.max - extent.min) / intervals))
  for (let power = exponent - 1; power <= exponent + 1; power += 1) {
    for (const base of [1, 2, 5]) {
      const step = base * 10 ** power
      const start = Math.floor(extent.min / step + 1e-9) * step
      const needed = Math.ceil((extent.max - start) / step - 1e-9)
      if (needed > intervals) continue
      const fill = (extent.max - extent.min) / (intervals * step)
      return fill >= 0.55
        ? { min: cleanFloat(start), max: cleanFloat(start + intervals * step), interval: cleanFloat(step) }
        : null
    }
  }
  return null
}

const plainFormatters = new Map<string, Intl.NumberFormat>()
const compactFormatters = new Map<string, Intl.NumberFormat>()

function plainFormatter(locale: string): Intl.NumberFormat {
  let formatter = plainFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 })
    plainFormatters.set(locale, formatter)
  }
  return formatter
}

function compactFormatter(locale: string): Intl.NumberFormat {
  let formatter = compactFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 })
    compactFormatters.set(locale, formatter)
  }
  return formatter
}

/** 无作者格式时的数值展示：保留有意义的精度，千分位随语言环境。 */
export function formatPlainNumber(value: number, locale: string): string {
  // 观测值不能套刻度的浮点清理：General 必须保留原数值，小数精度由作者显式格式控制。
  return plainFormatter(locale).format(Object.is(value, -0) ? 0 : value)
}

export interface FormatNumberInput {
  readonly numberFormat?: string
  readonly locale: string
}

/** tooltip、数据标签和数据表使用：作者格式优先，其次保留完整精度。 */
export function formatChartDisplayValue(value: number, input: FormatNumberInput): string {
  if (input.numberFormat && input.numberFormat !== 'General') return formatChartValue(value, input.numberFormat)
  return formatPlainNumber(value, input.locale)
}

/** 坐标轴刻度使用：从千位起紧凑（0 / 1K / 2K；中文 1万 / 2亿），不丢失作者格式。 */
export function formatChartAxisTick(value: number, input: FormatNumberInput): string {
  if (input.numberFormat && input.numberFormat !== 'General') return formatChartValue(value, input.numberFormat)
  const cleaned = cleanFloat(value)
  return Math.abs(cleaned) >= 1000
    ? compactFormatter(input.locale).format(cleaned)
    : plainFormatter(input.locale).format(cleaned)
}
