import type { Node } from 'prosemirror-model'

/** 内容块可提供无 DOM 的首屏高度估计；测量值始终优先，估计值不进入测量均值。 */
declare module 'prosemirror-model' {
  interface NodeSpec {
    estimateBlockHeight?: (node: Node) => number
  }
}
