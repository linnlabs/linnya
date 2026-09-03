import type { Topic } from '../../../domain/types/dom'
import type { MindMapInstance } from '../../../domain/types/index'
import { flickerLog } from '../../../shared/utils/debug/flickerDebug'
export { move, scale, scaleFit, scrollIntoView, toCenter } from '../../viewControls'
export {
  getData,
  getDataString,
  enableEdit,
  disableEdit,
  install,
  focusNode,
  cancelFocus,
  initLeft,
  initRight,
  initSide,
  setLocale,
  refresh,
} from '../../dataControls'
export { expandNode, expandNodeAll } from '../../nodeExpansion'

export const selectNode = function (this: MindMapInstance, tpc: Topic, isNewNode?: boolean, e?: MouseEvent): void {
  // selectNode clears all selected nodes by default
  // console.log('[nodeActions] selectNode called', { tpc, isNewNode, e })
  flickerLog('selectNode start', {
    t: performance.now(),
    nodeId: tpc?.nodeObj?.id ?? null,
    isNewNode: isNewNode === true,
    transition: this.map?.style?.transition ?? null,
    transform: this.map?.style?.transform ?? null,
  })
  this.clearSelection()
  // console.log('[nodeActions] after clearSelection', { 
  //   currentNodes: this.currentNodes, 
  //   selectionStore: this.selection?.getSelection() 
  // })
  // 中文说明（根因修复：杜绝“新建兄弟节点闪一下”）：
  // - 选中新节点时若触发 scrollIntoView 的平滑移动（transform transition），会与新增节点的几何 flush 叠加产生抖动/闪烁体感；
  // - 因此这里统一禁用 smooth（稳定、即时定位），不做任何过渡动画。
  this.scrollIntoView(tpc, false)
  this.selection?.select(tpc)
  flickerLog('selectNode end', {
    t: performance.now(),
    nodeId: tpc?.nodeObj?.id ?? null,
    transition: this.map?.style?.transition ?? null,
    transform: this.map?.style?.transform ?? null,
  })
  // console.log('[nodeActions] after select', { 
  //   currentNodes: this.currentNodes, 
  //   selectionStore: this.selection?.getSelection() 
  // })
  if (isNewNode) {
    this.bus.fire('selectNewNode', tpc.nodeObj)
  }
}

export const selectNodes = function (this: MindMapInstance, tpc: Topic[]): void {
  // update currentNodes in selection.ts to keep sync with SelectionArea cache
  this.selection?.select(tpc)
}

export const unselectNodes = function (this: MindMapInstance, tpc: Topic[]) {
  this.selection?.deselect(tpc)
}

export const clearSelection = function (this: MindMapInstance) {
  this.unselectNodes(this.currentNodes)
  this.unselectSummary()
  this.unselectArrow()

  // 强制清除所有残留的 selected 类
  // 这能解决因 DOM 替换导致的“幽灵选中”问题
  const selectedElements = this.container.querySelectorAll('.selected')
  selectedElements.forEach(el => el.classList.remove('selected'))

  // 中文说明：
  // - clearSelection 的语义必须同时清理“视觉选中”和“内存选中”（currentNodes）
  // - 当 selection 引擎被临时 disable/cancel（例如节点拖拽开始）时，依赖 selection.deselect 可能不会更新 currentNodes
  // - 这里显式归零，保证后续框选/单选逻辑不会把“旧选中”当作仍在选中
  this.currentNodes = []

  // 确保 selection 库内部状态也清空（如果 currentNodes 不同步）
  if (this.selection) {
    this.selection.clearSelection(true, true)
  }
}


/**
 * @function
 * @instance
 * @name refresh
 * @description Refresh mind map, you can use it after modified `this.nodeData`
 * @memberof MapInteraction
 * @param {TargetElement} data mind map data
 */
