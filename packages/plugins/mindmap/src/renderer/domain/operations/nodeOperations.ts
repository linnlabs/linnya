import { fillParent, refreshIds, unionTopics } from '../../shared/utils/index'
import { createExpander, shapeTpc } from '../../shared/utils/dom/index'
import { deepClone } from '../../shared/utils/index'
import type { Children, Topic } from '../types/dom'
import { DirectionClass, type MindMapInstance, type NodeObj } from '../types/index'
import { insertNodeObj, insertParentNodeObj, moveUpObj, moveDownObj, removeNodeObj, moveNodeObj } from '../../shared/utils/tree/nodeTreeOperations'
import { addChildDom, removeNodeDom } from '../../shared/utils/dom/domManipulation'
import { LEFT, RIGHT } from '../constants'
import { flickerLog } from '../../shared/utils/debug/flickerDebug'

const typeMap: Record<string, InsertPosition> = {
  before: 'beforebegin',
  after: 'afterend',
}

export const rmSubline = function (tpc: Topic) {
  const mainNode = tpc.parentElement.parentElement
  const lc = mainNode.lastElementChild
  if (lc?.tagName === 'svg') lc?.remove() // clear svg group of main node
}

export const reshapeNode = function (this: MindMapInstance, tpc: Topic, patchData: Partial<NodeObj>) {
  const nodeObj = tpc.nodeObj
  const origin = deepClone(nodeObj)
  // merge styles
  if (origin.style && patchData.style) {
    patchData.style = Object.assign(origin.style, patchData.style)
  }
  const newObj = Object.assign(nodeObj, patchData)
  shapeTpc.call(this, tpc, newObj)
  // 中文说明：节点 DOM 形状变化属于“几何变化”，统一走 ReflowScheduler 调度重算
  // 这里不需要立即计算（无后续依赖测量），用 requestReflow 合并同帧请求，避免抖动/重复计算
  this.requestReflow('node-operation:dom-changed')
  this.bus.fire('operation', {
    name: 'reshapeNode',
    obj: newObj,
    origin,
  })
}

type EditOption = { edit?: boolean }

const addChildFunc = function (mind: MindMapInstance, target: Topic, node?: NodeObj) {
  if (!target) return null
  const nodeObj = target.nodeObj
  if (nodeObj.expanded === false) {
    mind.expandNode(target, true)
    target = mind.findEle(nodeObj.id) as Topic
  }
  const newNodeObj = node || mind.generateNewObj()
  if (nodeObj.children) nodeObj.children.push(newNodeObj)
  else nodeObj.children = [newNodeObj]
  fillParent(mind.nodeData)

  const { grp, top: newTop } = mind.createWrapper(newNodeObj)
  addChildDom(mind, target, grp)
  return { newTop, newNodeObj }
}

export const insertSibling = function (this: MindMapInstance, type: 'before' | 'after', el?: Topic, node?: NodeObj, options?: EditOption) {
  const nodeEle = el || this.currentNode
  if (!nodeEle) return
  const nodeObj = nodeEle.nodeObj
  if (!nodeObj.parent) {
    this.addChild(undefined, undefined, options)
    return
  } else if (!nodeObj.parent?.parent && this.direction === 2) {
    const l = this.map.querySelector('.lhs')?.childElementCount || 0
    const r = this.map.querySelector('.rhs')?.childElementCount || 0
    if (!l || !r) {
      // add at least one node to another side
      this.addChild(this.findEle(nodeObj.parent!.id), node, options)
      return
    }
  }
  const newNodeObj = node || this.generateNewObj()
  if (!nodeObj.parent?.parent) {
    const direction = nodeEle.closest('mm-main')!.className === DirectionClass.LEFT ? LEFT : RIGHT
    newNodeObj.direction = direction
  }
  insertNodeObj(newNodeObj, type, nodeObj)
  fillParent(this.nodeData)
  const t = nodeEle.parentElement
  const { grp, top } = this.createWrapper(newNodeObj)

  t.parentElement.insertAdjacentElement(typeMap[type], grp)

  flickerLog('operation insertSibling DOM inserted', {
    t: performance.now(),
    type,
    newNodeId: newNodeObj.id,
    basedOnNodeId: nodeObj.id,
    structureRevision: this.structureRevision,
    transition: this.map?.style?.transition ?? null,
    transform: this.map?.style?.transform ?? null,
  })

  // 中文说明：
  // - 以前这里用 `grp.offsetParent` 做“局部重算”，但它依赖 CSS 定位关系，容易脆弱（基础不稳）
  // - 若仅 requestReflow（下一帧 flush），会出现“节点已插入但连线下一帧才补上”的 1 帧中间态，体感就是“闪一下”
  // - 这里属于强时序点位：新增节点后必须在同一帧完成连线/几何同步，才能做到 0 闪烁
  this.requestReflowNow('node-operation:dom-changed')

  flickerLog('operation insertSibling reflowNow done', {
    t: performance.now(),
    type,
    newNodeId: newNodeObj.id,
    structureRevision: this.structureRevision,
  })

  const shouldEdit = options?.edit ?? !node
  if (shouldEdit) {
    this.editTopic(top.firstChild)
  }
  this.bus.fire('operation', {
    name: 'insertSibling',
    type,
    obj: newNodeObj,
  })
  this.selectNode(top.firstChild, true)
}

export const insertParent = function (this: MindMapInstance, el?: Topic, node?: NodeObj, options?: EditOption) {
  const nodeEle = el || this.currentNode
  if (!nodeEle) return
  rmSubline(nodeEle)
  const nodeObj = nodeEle.nodeObj
  if (!nodeObj.parent) {
    return
  }
  const newNodeObj = node || this.generateNewObj()
  insertParentNodeObj(nodeObj, newNodeObj)
  fillParent(this.nodeData)

  const grp0 = nodeEle.parentElement.parentElement
  const { grp, top } = this.createWrapper(newNodeObj, true)
  const expander = createExpander(this, newNodeObj, true)
  top.appendChild(expander)
  const topic = top.firstChild as Topic | null
  if (topic) {
    topic.expander = expander
  }
  grp0.insertAdjacentElement('afterend', grp)

  const c = this.createChildren([grp0])
  top.insertAdjacentElement('afterend', c)

  // 中文说明：
  // - 插入父节点属于结构性 DOM 注入，连线必须与新结构同步；
  // - 若延迟到下一帧再 flush，会出现 1 帧“线条缺失/错位”的中间态（闪一下）。
  this.requestReflowNow('node-operation:dom-changed')

  const shouldEdit = options?.edit ?? !node
  if (shouldEdit) {
    this.editTopic(top.firstChild)
  }
  this.selectNode(top.firstChild, true)
  this.bus.fire('operation', {
    name: 'insertParent',
    obj: newNodeObj,
  })
}

export const addChild = function (this: MindMapInstance, el?: Topic, node?: NodeObj, options?: EditOption) {
  const nodeEle = el || this.currentNode
  if (!nodeEle) return
  const res = addChildFunc(this, nodeEle, node)
  if (!res) return
  const { newTop, newNodeObj } = res
  // 中文说明：
  // - addChild 会插入新的节点 DOM（wrapper/topic/children 容器），必然影响连线几何
  // - 若仅 requestReflow（下一帧 flush），会有 1 帧“节点已出现但线条未就绪”的中间态；
  // - 为了杜绝任何可感知的闪烁，这里用强时序 flush 保证同帧一致。
  this.requestReflowNow('node-operation:dom-changed')
  // 添加节点关注添加节点前选择的节点，所以先触发事件再选择节点
  this.bus.fire('operation', {
    name: 'addChild',
    obj: newNodeObj,
  })
  const shouldEdit = options?.edit ?? !node
  if (shouldEdit) {
    this.editTopic(newTop.firstChild)
  }
  this.selectNode(newTop.firstChild, true)
}

export const copyNode = function (this: MindMapInstance, node: Topic, to: Topic) {
  const deepCloneObj = deepClone(node.nodeObj)
  refreshIds(deepCloneObj)
  const res = addChildFunc(this, to, deepCloneObj)
  if (!res) return
  const { newNodeObj } = res
  this.selectNode(this.findEle(newNodeObj.id))
  this.bus.fire('operation', {
    name: 'copyNode',
    obj: newNodeObj,
  })
}

export const copyNodes = function (this: MindMapInstance, tpcs: Topic[], to: Topic) {
  tpcs = unionTopics(tpcs)
  const objs = []
  for (let i = 0; i < tpcs.length; i++) {
    const node = tpcs[i]
    const deepCloneObj = deepClone(node.nodeObj)
    refreshIds(deepCloneObj)
    const res = addChildFunc(this, to, deepCloneObj)
    if (!res) return
    const { newNodeObj } = res
    objs.push(newNodeObj)
  }
  this.unselectNodes(this.currentNodes)
  this.selectNodes(objs.map(obj => this.findEle(obj.id)))
  this.bus.fire('operation', {
    name: 'copyNodes',
    objs,
  })
}

export const moveUpNode = function (this: MindMapInstance, el?: Topic) {
  const nodeEle = el || this.currentNode
  if (!nodeEle) return
  const obj = nodeEle.nodeObj
  moveUpObj(obj)
  const grp = nodeEle.parentNode.parentNode
  grp.parentNode.insertBefore(grp, grp.previousSibling)
  // 中文说明：节点移动导致连线几何变化，统一走 ReflowScheduler 调度重算
  this.requestReflow('node-operation:dom-changed')
  this.bus.fire('operation', {
    name: 'moveUpNode',
    obj,
  })
}

export const moveDownNode = function (this: MindMapInstance, el?: Topic) {
  const nodeEle = el || this.currentNode
  if (!nodeEle) return
  const obj = nodeEle.nodeObj
  moveDownObj(obj)
  const grp = nodeEle.parentNode.parentNode
  if (grp.nextSibling) {
    grp.nextSibling.insertAdjacentElement('afterend', grp)
  } else {
    grp.parentNode.prepend(grp)
  }
  // 中文说明：节点移动导致连线几何变化，统一走 ReflowScheduler 调度重算
  this.requestReflow('node-operation:dom-changed')
  this.bus.fire('operation', {
    name: 'moveDownNode',
    obj,
  })
}

type RemoveNodesOptions = { afterSelectNodeId?: string | null }

export const removeNodes = function (this: MindMapInstance, tpcs: Topic[], options?: RemoveNodesOptions) {
  if (tpcs.length === 0) return
  tpcs = unionTopics(tpcs)

  // 使用 nodeObj 关系进行过滤，只保留顶层节点
  const idsToDelete = new Set(tpcs.map(t => t.nodeObj.id))
  const finalNodesToDelete = tpcs.filter(t => {
    let current = t.nodeObj.parent
    while (current) {
      if (idsToDelete.has(current.id)) {
        return false // 祖先也在删除列表中，跳过当前节点
      }
      current = current.parent
    }
    return true
  })

  /**
   * 删除后选中节点（由 commands 决策，operations 执行）
   *
   * 中文说明：
   * - Phase 1/3 的 history 快照仍依赖“operation 触发时 currentNodes 已是删除后的选中”
   * - 因此：必须在 fire('operation') 之前完成 selection
   * - 选中策略本应由命令层统一决策；这里保留 fallback 以兼容直接调用 operations 的旧入口
   */
  const findNodeObjByIdInTree = (nodeId: string, root: NodeObj): NodeObj | null => {
    if (root.id === nodeId) return root
    const children = root.children ?? []
    for (const child of children) {
      const found = findNodeObjByIdInTree(nodeId, child)
      if (found) return found
    }
    return null
  }

  const resolveSelectableTopic = (nodeId: string): Topic | null => {
    // 1) 直接命中
    try {
      return this.findEle(nodeId)
    } catch {
      // ignore
    }
    // 2) 在 data 中找最近可见祖先
    const nodeObj = findNodeObjByIdInTree(nodeId, this.nodeData)
    let current = nodeObj?.parent
    while (current) {
      try {
        return this.findEle(current.id)
      } catch {
        current = current.parent
      }
    }
    return null
  }

  const computeFallbackAfterSelectNodeId = (): string | null => {
    if (finalNodesToDelete.length === 0) return null
    const deleteIds = new Set(finalNodesToDelete.map((t) => t.nodeObj.id))
    let removedObj = finalNodesToDelete[finalNodesToDelete.length - 1]!.nodeObj

    // 非规范输入：如果 parent 也在删除集合中，向上收敛到最近一层 parent 不被删除
    while (removedObj.parent && deleteIds.has(removedObj.parent.id)) {
      removedObj = removedObj.parent
    }

    const parent = removedObj.parent
    if (!parent) return null
    const siblings = parent.children ?? []
    const index = siblings.findIndex((child) => child.id === removedObj.id)
    if (index === -1) return parent.id

    for (let i = index + 1; i < siblings.length; i++) {
      const candidate = siblings[i]
      if (candidate && !deleteIds.has(candidate.id)) return candidate.id
    }
    for (let i = index - 1; i >= 0; i--) {
      const candidate = siblings[i]
      if (candidate && !deleteIds.has(candidate.id)) return candidate.id
    }
    return parent.id
  }

  // 先确定删除后应选中的 nodeId（commands 优先，fallback 兜底）
  const afterSelectNodeId = options?.afterSelectNodeId ?? computeFallbackAfterSelectNodeId()

  for (const tpc of finalNodesToDelete) {
    const nodeObj = tpc.nodeObj
    const siblingLength = removeNodeObj(nodeObj)
    removeNodeDom(tpc, siblingLength)
  }

  // 删除后选中必须发生在 operation 事件之前（history 快照契约）
  if (afterSelectNodeId) {
    const target = resolveSelectableTopic(afterSelectNodeId)
    if (target) {
      this.selectNode(target)
    } else {
      this.clearSelection()
    }
  }

  // 中文说明：节点删除导致几何变化，统一走 ReflowScheduler 调度重算
  this.requestReflow('node-operation:dom-changed')
  // 删除关注的是删除后选择的节点，所以先选择节点再触发 removeNodes 事件可以在事件中通过 currentNodes 获取之后选择的节点
  this.bus.fire('operation', {
    name: 'removeNodes',
    objs: finalNodesToDelete.map(tpc => tpc.nodeObj),
  })
}

export const moveNodeIn = function (this: MindMapInstance, from: Topic[], to: Topic) {
  from = unionTopics(from)
  const toObj = to.nodeObj
  if (toObj.expanded === false) {
    // TODO
    this.expandNode(to, true)
    to = this.findEle(toObj.id) as Topic
  }
  for (const f of from) {
    const obj = f.nodeObj
    moveNodeObj('in', obj, toObj)
    fillParent(this.nodeData) // update parent property
    const fromTop = f.parentElement
    addChildDom(this, to, fromTop.parentElement)
  }
  // 中文说明：节点挪入导致几何变化，统一走 ReflowScheduler 调度重算
  this.requestReflow('node-operation:dom-changed')
  this.bus.fire('operation', {
    name: 'moveNodeIn',
    objs: from.map(f => f.nodeObj),
    toObj,
  })
}

const moveNode = (from: Topic[], type: 'before' | 'after', to: Topic, mind: MindMapInstance) => {
  from = unionTopics(from)
  if (type === 'after') {
    from = from.reverse()
  }
  const toObj = to.nodeObj
  const c: Children[] = []
  for (const f of from) {
    const obj = f.nodeObj
    moveNodeObj(type, obj, toObj)
    fillParent(mind.nodeData)
    rmSubline(f)
    const fromWrp = f.parentElement.parentNode
    if (!c.includes(fromWrp.parentElement)) {
      c.push(fromWrp.parentElement)
    }
    const toWrp = to.parentElement.parentNode
    toWrp.insertAdjacentElement(typeMap[type], fromWrp)
  }
  // When nodes are moved away, the original parent node may become childless
  // In this case, we need to clean up the related DOM structure:
  // remove expander buttons and empty wrapper containers
  for (const item of c) {
    if (item.childElementCount === 0 && item.tagName !== 'MM-MAIN') {
      item.previousSibling.children[1]!.remove()
      item.remove()
    }
  }
  // 中文说明：节点前后移动导致几何变化，统一走 ReflowScheduler 调度重算
  mind.requestReflow('node-operation:dom-changed')
  mind.bus.fire('operation', {
    name: type === 'before' ? 'moveNodeBefore' : 'moveNodeAfter',
    objs: from.map(f => f.nodeObj),
    toObj,
  })
}

export const moveNodeBefore = function (this: MindMapInstance, from: Topic[], to: Topic) {
  moveNode(from, 'before', to, this)
}

export const moveNodeAfter = function (this: MindMapInstance, from: Topic[], to: Topic) {
  moveNode(from, 'after', to, this)
}

export const beginEdit = function (this: MindMapInstance, el?: Topic) {
  const nodeEle = el || this.currentNode
  if (!nodeEle) return
  if (nodeEle.nodeObj.dangerouslySetInnerHTML || nodeEle.nodeObj.richContent) return
  this.editTopic(nodeEle)
}

export const setNodeTopic = function (this: MindMapInstance, el: Topic, topic: string) {
  el.text.textContent = topic
  el.nodeObj.topic = topic
  // 中文说明：文本变化可能导致节点尺寸变化，统一走 ReflowScheduler 调度重算
  this.requestReflow('node-operation:dom-changed')
}
