import type { Arrow } from '../../presentation/render/arrow'
import type { NodeObj } from './index'

export interface Wrapper extends HTMLElement {
  firstChild: Node
  children: HTMLCollection & [Node, Children]
  parentNode: Children
  parentElement: Children
  offsetParent: Wrapper
  previousSibling: Wrapper | null
  nextSibling: Wrapper | null
}

/** Represents a single node in the mind map (corresponds to mm-node element) */
export interface Node extends HTMLElement {
  firstChild: Topic
  children: HTMLCollection & [Topic, Expander | undefined]
  parentNode: Wrapper
  parentElement: Wrapper
  nextSibling: Children
  offsetParent: Wrapper
}

// Backward compatibility alias
export type Parent = Node

export interface Children extends HTMLElement {
  parentNode: Wrapper
  children: HTMLCollection & Wrapper[]
  parentElement: Wrapper
  firstChild: Wrapper
  previousSibling: Node
}

/** Represents the content of a single topic node (corresponds to mm-topic element) */
export interface Topic extends HTMLElement {
  nodeObj: NodeObj
  parentNode: Node
  parentElement: Node
  offsetParent: Node

  text: HTMLSpanElement
  expander?: Expander

  link?: HTMLElement
  image?: HTMLImageElement
  icons?: HTMLSpanElement
  tags?: HTMLDivElement
  /**
   * 节点内部扩展区域（插件挂载点）
   *
   * 中文说明：
   * - 该区域由 `shapeTpc` 统一创建，用于挂载“feature UI”（例如证据、附件、快捷操作）。
   * - 这样 feature 可以通过 Teleport 渲染到节点内部，从而真实改变节点尺寸并触发布局重排。
   */
  addons?: HTMLDivElement
}

/** Represents the expand/collapse button (corresponds to mm-expander element) */
export interface Expander extends HTMLElement {
  expanded?: boolean
  parentNode: Node
  parentElement: Node
  previousSibling: Topic
}

export type CustomLine = SVGPathElement
export type CustomArrow = SVGPathElement
export interface CustomSvg extends SVGGElement {
  arrowObj: Arrow
  labelEl?: HTMLDivElement // Reference to the label div element
  line: SVGPathElement
  arrow1: SVGPathElement
  arrow2: SVGPathElement
}
