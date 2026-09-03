import type { MindMapInstance, MindMapData } from '../types/index'
import linkDiv from '../../presentation/render/links'
import { editTopic, createWrapper, createParent, createChildren, createTopic, findEle } from '../../shared/utils/dom/index'
import { getObjById, generateNewObj, fillParent } from '../../shared/utils/index'
import { layout } from '../../shared/utils/layout/index'
import { changeTheme } from '../../shared/utils/theme/index'
import * as interact from '../../interaction/index'
import * as nodeOperation from '../operations/nodeOperations'
import * as arrow from '../../presentation/render/arrow'
import * as summary from '../../presentation/render/summary'
import { exportSvg, exportPng } from '../../shared/utils/export'
import { initRuntimePlugins } from '../../presentation/engine/plugins'
import { applyBeforeHooks } from './hooks'
import { fireStructureReady } from '../../shared/utils/events/lifecycleSignals'

export type OperationMap = typeof nodeOperation
export type Operations = keyof OperationMap

const nodeOperationHooked = applyBeforeHooks(nodeOperation, import.meta.env.MODE)

/**
 * Methods that MindMap instance can use
 *
 * @public
 */
const methods = {
  getObjById,
  generateNewObj,
  layout,
  linkDiv,
  editTopic,
  createWrapper,
  createParent,
  createChildren,
  createTopic,
  findEle,
  changeTheme,
  ...interact,
  ...nodeOperationHooked,
  ...arrow,
  ...summary,
  exportSvg,
  exportPng,
  init(this: MindMapInstance, data: MindMapData) {
    data = JSON.parse(JSON.stringify(data))
    if (!data || !data.nodeData) return new Error('MindMap: `data` is required')
    if (data.direction !== undefined) {
      this.direction = data.direction
    }
    this.changeTheme(data.theme || this.theme, false)
    this.nodeData = data.nodeData
    fillParent(this.nodeData)
    this.arrows = data.arrows || []
    this.summaries = data.summaries || []
    this.tidyArrow()
    // plugins
    this.disposable.push(...initRuntimePlugins(this))
    this.layout()
    // 中文说明：
    // - init 属于“首屏结构重建”流程：layout() 刚刚重建完节点 DOM
    // - 这里必须紧跟一次“强时序重算”，确保连线与节点结构在同一轮初始化中同步完成
    // - 不走 requestReflow：避免把首屏连线绘制延后到下一帧导致短暂不一致（白板体验会很差）
    // - 统一走 requestReflowNow：保证同样具备 geometryFlushed 可观测信号（见 docs/MINDMAP_DEV_GUIDE.md）
    this.requestReflowNow('core:init')

    // 中文说明：结构重建完成后发出 structureReady（仅当 documentId 已绑定）
    fireStructureReady(this)

    // 中文说明（架构重构）：
    // - init() 不再默认调用 toCenter()。
    // - 视口定位（居中/恢复历史位置）完全交由上层（mindmapStore）在“内容稳定后”统一调度。
    // - 彻底移除 __skipToCenterOnce 补丁。
  },
  destroy(this: Partial<MindMapInstance>) {
    this.disposable!.forEach(fn => fn())
    if (this.el) this.el.innerHTML = ''
    this.el = undefined
    this.nodeData = undefined
    this.arrows = undefined
    this.summaries = undefined
    this.currentArrow = undefined
    this.currentNodes = undefined
    this.currentSummary = undefined
    this.waitCopy = undefined
    this.theme = undefined
    this.direction = undefined
    this.bus = undefined
    this.container = undefined
    this.map = undefined
    this.lines = undefined
    this.linkController = undefined
    this.linkSvgGroup = undefined
    this.P2 = undefined
    this.P3 = undefined
    this.line1 = undefined
    this.line2 = undefined
    this.nodes = undefined
    this.selection = undefined
  },
}

export type MindMapMethods = typeof methods
export default methods

