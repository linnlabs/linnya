/**
 * blockHeightCache.ts
 *
 * RootBlock placeholder 高度缓存。
 *
 * 中文说明：
 * - placeholder 不能渲染真实 contentDOM，但必须尽量保留滚动高度；
 * - 缓存只记录 blockId → height，不认识 revision、annotation、NodeView；
 * - 高度测量来自 controller / NodeView 外层，状态模块只做归一化和存储。
 */

import {
  ADAPTIVE_BLOCK_HEIGHT_MAX_ELEMENT_HEIGHT,
  ADAPTIVE_BLOCK_HEIGHT_MIN_ELEMENT_HEIGHT,
  ADAPTIVE_BLOCK_HEIGHT_MIN_SAMPLE_COUNT,
  DEFAULT_PLACEHOLDER_ROOT_BLOCK_HEIGHT,
  DEFAULT_ROOT_BLOCK_LAYOUT_MARGIN_AFTER,
} from '../renderVirtualizationConstants'

export interface BlockHeightCacheOptions {
  defaultHeight?: number
  defaultMarginBefore?: number
  defaultMarginAfter?: number
  minHeight?: number
  maxHeight?: number
}

export interface BlockHeightCacheSnapshot {
  size: number
  defaultHeight: number
  defaultMarginBefore: number
  defaultMarginAfter: number
  minHeight: number
  maxHeight: number
  measuredCount: number
  adaptiveElementHeight: number
  adaptiveMarginBefore: number
  adaptiveMarginAfter: number
}

export interface BlockHeightMeasurement {
  elementHeight: number
  marginBefore?: number
  marginAfter?: number
}

interface NormalizedBlockHeightMeasurement {
  elementHeight: number
  marginBefore: number
  marginAfter: number
}

export class BlockHeightCache {
  private readonly measurements = new Map<string, NormalizedBlockHeightMeasurement>()
  private readonly defaultHeight: number
  private readonly defaultMarginBefore: number
  private readonly defaultMarginAfter: number
  private readonly minHeight: number
  private readonly maxHeight: number
  private measuredElementHeightTotal = 0
  private measuredMarginBeforeTotal = 0
  private measuredMarginAfterTotal = 0

  constructor(options: BlockHeightCacheOptions = {}) {
    this.defaultHeight = normalizeHeight(options.defaultHeight, DEFAULT_PLACEHOLDER_ROOT_BLOCK_HEIGHT)
    this.defaultMarginBefore = normalizeNonNegativeNumber(options.defaultMarginBefore, 0)
    this.defaultMarginAfter = normalizeNonNegativeNumber(
      options.defaultMarginAfter,
      DEFAULT_ROOT_BLOCK_LAYOUT_MARGIN_AFTER
    )
    this.minHeight = normalizeHeight(options.minHeight, 24)
    this.maxHeight = normalizeHeight(options.maxHeight, 2000)
  }

  get(blockId: string): number {
    return this.measurements.get(blockId)?.elementHeight ?? this.createDefaultMeasurement().elementHeight
  }

  getLayoutHeight(blockId: string): number {
    const measurement = this.measurements.get(blockId) ?? this.createDefaultMeasurement()
    return measurement.elementHeight + measurement.marginBefore + measurement.marginAfter
  }

  estimateTotalLayoutHeight(blockCount: number): number {
    const safeBlockCount = Math.max(0, Math.round(blockCount))
    if (safeBlockCount === 0) return 0
    const defaultMeasurement = this.createDefaultMeasurement()
    return safeBlockCount * (
      defaultMeasurement.elementHeight +
      defaultMeasurement.marginBefore +
      defaultMeasurement.marginAfter
    )
  }

  has(blockId: string): boolean {
    return this.measurements.has(blockId)
  }

  set(blockId: string, heightOrMeasurement: number | BlockHeightMeasurement): void {
    if (!blockId) return
    const previous = this.measurements.get(blockId)
    if (previous) this.subtractMeasurement(previous)
    const next = this.normalizeMeasurement(heightOrMeasurement)
    this.measurements.set(blockId, next)
    this.addMeasurement(next)
  }

  delete(blockId: string): void {
    const previous = this.measurements.get(blockId)
    if (previous) this.subtractMeasurement(previous)
    this.measurements.delete(blockId)
  }

  clear(): void {
    this.measurements.clear()
    this.measuredElementHeightTotal = 0
    this.measuredMarginBeforeTotal = 0
    this.measuredMarginAfterTotal = 0
  }

  snapshot(): BlockHeightCacheSnapshot {
    const adaptive = this.createDefaultMeasurement()
    return {
      size: this.measurements.size,
      defaultHeight: this.defaultHeight,
      defaultMarginBefore: this.defaultMarginBefore,
      defaultMarginAfter: this.defaultMarginAfter,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
      measuredCount: this.measurements.size,
      adaptiveElementHeight: adaptive.elementHeight,
      adaptiveMarginBefore: adaptive.marginBefore,
      adaptiveMarginAfter: adaptive.marginAfter,
    }
  }

  private createDefaultMeasurement(): NormalizedBlockHeightMeasurement {
    if (this.measurements.size >= ADAPTIVE_BLOCK_HEIGHT_MIN_SAMPLE_COUNT) {
      return {
        elementHeight: this.clampAdaptiveDefaultHeight(
          this.measuredElementHeightTotal / this.measurements.size
        ),
        marginBefore: normalizeNonNegativeNumber(
          this.measuredMarginBeforeTotal / this.measurements.size,
          this.defaultMarginBefore
        ),
        marginAfter: normalizeNonNegativeNumber(
          this.measuredMarginAfterTotal / this.measurements.size,
          this.defaultMarginAfter
        ),
      }
    }

    return {
      elementHeight: this.defaultHeight,
      marginBefore: this.defaultMarginBefore,
      marginAfter: this.defaultMarginAfter,
    }
  }

  private normalizeMeasurement(
    heightOrMeasurement: number | BlockHeightMeasurement
  ): NormalizedBlockHeightMeasurement {
    if (typeof heightOrMeasurement === 'number') {
      return {
        elementHeight: this.clampHeight(heightOrMeasurement),
        marginBefore: this.defaultMarginBefore,
        marginAfter: this.defaultMarginAfter,
      }
    }

    return {
      elementHeight: this.clampHeight(heightOrMeasurement.elementHeight),
      marginBefore: normalizeNonNegativeNumber(
        heightOrMeasurement.marginBefore,
        this.defaultMarginBefore
      ),
      marginAfter: normalizeNonNegativeNumber(
        heightOrMeasurement.marginAfter,
        this.defaultMarginAfter
      ),
    }
  }

  private clampHeight(height: number): number {
    return Math.min(this.maxHeight, Math.max(this.minHeight, normalizeHeight(height, this.defaultHeight)))
  }

  private clampAdaptiveDefaultHeight(height: number): number {
    return Math.min(
      ADAPTIVE_BLOCK_HEIGHT_MAX_ELEMENT_HEIGHT,
      Math.max(
        ADAPTIVE_BLOCK_HEIGHT_MIN_ELEMENT_HEIGHT,
        this.clampHeight(height)
      )
    )
  }

  private addMeasurement(measurement: NormalizedBlockHeightMeasurement): void {
    this.measuredElementHeightTotal += measurement.elementHeight
    this.measuredMarginBeforeTotal += measurement.marginBefore
    this.measuredMarginAfterTotal += measurement.marginAfter
  }

  private subtractMeasurement(measurement: NormalizedBlockHeightMeasurement): void {
    this.measuredElementHeightTotal -= measurement.elementHeight
    this.measuredMarginBeforeTotal -= measurement.marginBefore
    this.measuredMarginAfterTotal -= measurement.marginAfter
  }
}

function normalizeHeight(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.round(value)
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }
  return Math.round(value)
}
