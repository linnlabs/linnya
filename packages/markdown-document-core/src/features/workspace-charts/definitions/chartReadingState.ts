/**
 * @file chartReadingState.ts
 * @description 图表的阅读状态：读者临时的筛选、突出和范围聚焦。
 *
 * 阅读状态不属于文档内容：它不写入正文、不产生版本或 Pending、不进入 undo，也不进入
 * 内部剪贴板。它只描述“同一份规格怎样被临时观看”，因此用纯值表达，ECharts 实例不进入这里。
 */

export interface ChartIndexRange {
  /** 含端点，指向 `spec.categories` 的下标。 */
  readonly start: number
  readonly end: number
}

export type ChartReadingVariant = 'document' | 'proposed' | 'baseline'

export interface ChartReadingKey {
  readonly editorSessionId: string
  readonly blockId: string
  readonly variant: ChartReadingVariant
}

export interface ChartReadingEntry {
  readonly state: ChartReadingState
  /** 离屏更新后再次挂载也能判定旧筛选已经失效。 */
  readonly semanticKey: string
}

export interface ChartValueRange {
  readonly min: number
  readonly max: number
}

export interface ChartReadingState {
  /** 被隐藏的系列名（系列名在图内唯一）。仅柱/线/面积/组合/散点/雷达使用。 */
  readonly hiddenSeries: readonly string[]
  /**
   * 持久突出的对象：系列名；饼/环和按类目着色的柱图为完整规格的类目下标字符串（`"0"`、`"1"`…）。
   * 突出只改变视觉权重，不隐藏数据、不改变占比。
   */
  readonly emphasis: string | null
  /** 类目范围聚焦（柱/线/面积/组合）。 */
  readonly categoryRange: ChartIndexRange | null
  /** 散点的 X / Y 范围聚焦。 */
  readonly xRange: ChartValueRange | null
  readonly yRange: ChartValueRange | null
}

export const DEFAULT_CHART_READING_STATE: ChartReadingState = Object.freeze({
  hiddenSeries: Object.freeze([]),
  emphasis: null,
  categoryRange: null,
  xRange: null,
  yRange: null,
})
