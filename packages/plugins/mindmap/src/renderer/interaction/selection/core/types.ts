import type SelectionArea from './SelectionEngine'
import type { Intersection, Trigger } from '../utils/helpers'

/**
 * DeepPartial（深度可选）
 *
 * 中文说明：
 * - 用于 SelectionOptions 的“部分配置”场景（只传入需要覆盖的字段）
 * - 函数类型必须保持原样（否则会被递归展开成 {}，导致类型不兼容）
 */
export type DeepPartial<T> =
  T extends null | undefined
    ? T
    : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T extends unknown[]
      ? T
      : T extends HTMLElement
        ? T
        : { [P in keyof T]?: DeepPartial<T[P]> }

export type Quantify<T> = T[] | T

export interface ScrollEvent extends MouseEvent {
  deltaY: number
  deltaX: number
}

export interface ChangedElements {
  added: Element[]
  removed: Element[]
}

export interface SelectionStore {
  touched: Element[]
  stored: Element[]
  selected: Element[]
  changed: ChangedElements
}

export interface SelectionEvent {
  event: MouseEvent | TouchEvent | null
  store: SelectionStore
  selection: SelectionArea
}

export type SelectionEvents = {
  beforestart: (e: SelectionEvent) => boolean | void
  beforedrag: (e: SelectionEvent) => boolean | void
  start: (e: SelectionEvent) => void
  move: (e: SelectionEvent) => void
  stop: (e: SelectionEvent) => void
}

export type AreaLocation = {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Coordinates {
  x: number
  y: number
}

export type TapMode = 'touch' | 'native'
export type OverlapMode = 'keep' | 'drop' | 'invert'

export interface Scrolling {
  speedDivider: number
  manualSpeed: number
  startScrollMargins: { x: number; y: number }
}

export interface SingleTap {
  allow: boolean
  intersect: TapMode
}

export interface Features {
  deselectOnBlur: boolean
  singleTap: SingleTap
  range: boolean
  touch: boolean
}

export interface Behaviour {
  intersect: Intersection
  startThreshold: number | Coordinates
  overlap: OverlapMode
  scrolling: Scrolling
  triggers: Trigger[]
}

export interface SelectionOptions {
  selectionAreaClass: string
  selectionContainerClass: string | undefined
  container: Quantify<string | HTMLElement>

  document: Document
  selectables: Quantify<string>

  startAreas: Quantify<string | HTMLElement>
  boundaries: Quantify<string | HTMLElement>

  behaviour: Behaviour
  features: Features
  mindMapInstance?: any // MindMap instance for custom scrolling
  debug?: boolean
  filterTarget?: (target: HTMLElement, evt: MouseEvent | TouchEvent) => boolean
  /**
   * 抑制“拖拽框选”的宿主规则（由 Adapter 注入）
   *
   * 中文说明：
   * - Selection 引擎本身不应了解宿主（MindMap）的 DOM 结构（例如 mm-topic）。
   * - 但“从某类元素起点开始的手势应优先交给别的交互系统（如节点拖拽）”是通用需求。
   * - 因此把“是否应抑制 drag selection”的判断抽为可注入规则，核心只负责在正确时机（down→drag）执行。
   *
   * 约束：
   * - 该函数只用于决定“是否允许进入拖拽框选”，不影响 tap（单击选择）。
   * - 入参必须是 down 阶段的真实起点元素（move 阶段的 event.target 可能漂移）。
   */
  suppressDragSelectionFromDownTarget?: (target: Element) => boolean
}

export type PartialSelectionOptions = DeepPartial<Omit<SelectionOptions, 'document'>> & {
  document?: Document
}
