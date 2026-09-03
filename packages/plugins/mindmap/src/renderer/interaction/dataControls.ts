import type { Topic } from '../domain/types/dom'
import type { MindMapData, MindMapInstance } from '../domain/types/index'
import { fillParent } from '../shared/utils/tree/index'
import { fireStructureReady } from '../shared/utils/events/lifecycleSignals'

const collectData = (mind: MindMapInstance) => ({
  nodeData: mind.isFocusMode ? mind.nodeDataBackup : mind.nodeData,
  arrows: mind.arrows,
  summaries: mind.summaries,
  direction: mind.direction,
  theme: mind.theme,
})

export const getDataString = function (this: MindMapInstance) {
  const data = collectData(this)
  return JSON.stringify(data, (key, value) => {
    if (key === 'parent' && typeof value !== 'string') return undefined
    return value
  })
}

export const getData = function (this: MindMapInstance) {
  return JSON.parse(this.getDataString()) as MindMapData
}

export const enableEdit = function (this: MindMapInstance) {
  this.editable = true
}

export const disableEdit = function (this: MindMapInstance) {
  this.editable = false
}

export const install = function (this: MindMapInstance, plugin: (instance: MindMapInstance) => void) {
  plugin(this)
}

export const focusNode = function (this: MindMapInstance, el: Topic) {
  if (!el.nodeObj.parent) return
  this.clearSelection()
  if (this.tempDirection === null) {
    this.tempDirection = this.direction
  }
  if (!this.isFocusMode) {
    this.nodeDataBackup = this.nodeData
    this.isFocusMode = true
  }
  this.nodeData = el.nodeObj
  this.initRight()
  this.toCenter()
}

export const cancelFocus = function (this: MindMapInstance) {
  this.isFocusMode = false
  if (this.tempDirection !== null) {
    this.nodeData = this.nodeDataBackup
    this.direction = this.tempDirection
    this.tempDirection = null
    this.refresh()
    this.toCenter()
  }
}

export const initLeft = function (this: MindMapInstance) {
  this.direction = 0
  this.refresh()
  this.toCenter()
  // 中文说明：迁移到 state:* 新事件名（事件契约）
  this.bus.fire('state:directionChanged', this.direction)
}

export const initRight = function (this: MindMapInstance) {
  this.direction = 1
  this.refresh()
  this.toCenter()
  this.bus.fire('state:directionChanged', this.direction)
}

export const initSide = function (this: MindMapInstance) {
  this.direction = 2
  this.refresh()
  this.toCenter()
  this.bus.fire('state:directionChanged', this.direction)
}

export const setLocale = function (this: MindMapInstance, locale: string) {
  this.locale = locale
  this.refresh()
}

export const refresh = function (this: MindMapInstance, data?: MindMapData) {
  this.clearSelection()
  if (data) {
    const cloned = JSON.parse(JSON.stringify(data)) as MindMapData
    this.nodeData = cloned.nodeData
    this.arrows = cloned.arrows || []
    this.summaries = cloned.summaries || []
    // 中文说明：
    // - 与 init() 对齐：refresh(data) 也需要清理“无效箭头”
    // - 否则当后端返回的 arrows 引用了已删除/不可达节点时，渲染阶段会产生异常与控制台噪声
    this.tidyArrow()
    // 中文说明（根因修复）：
    // - refresh(data) 本身就是“结构重建流程”，内部会 layout + requestReflowNow
    // - changeTheme() 默认会再次调用 refresh()，导致一次 refresh(data) 触发两次结构重建
    // - 在 undo/redo（operationHistory）与 loadContent 场景下会表现为“闪一下/暗一下”
    // - 因此这里必须禁用 changeTheme 的二次 refresh
    cloned.theme && this.changeTheme(cloned.theme, false)
  }
  fillParent(this.nodeData)
  this.layout()
  // 中文说明：
  // - refresh 属于“结构重建”流程：layout() 会重建节点 DOM
  // - 这里需要紧跟一次“强时序重算”，确保连线与节点在同一轮重建后同步完成
  // - 不走 scheduler：避免把“结构重建的必需步骤”延后到下一帧，引入可见的短暂不一致
  // - 统一走 requestReflowNow：保证同样具备 geometryFlushed 可观测信号（见 docs/MINDMAP_DEV_GUIDE.md）
  this.requestReflowNow('core:refresh')

  // 中文说明：结构重建完成后发出 structureReady（仅当 documentId 已绑定）
  fireStructureReady(this)
}

