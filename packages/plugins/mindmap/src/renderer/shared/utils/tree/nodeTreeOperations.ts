import type { NodeObj } from '../../../domain/types/index'

/**
 * 获取节点的兄弟节点列表及其在列表中的索引
 * @param obj 目标节点
 * @returns 包含兄弟节点数组和当前节点索引的对象
 */
const getSibling = (obj: NodeObj): { siblings: NodeObj[] | undefined; index: number } => {
  const siblings = obj.parent?.children as NodeObj[]
  const index = siblings?.indexOf(obj) ?? 0
  return { siblings, index }
}

/**
 * 向上移动节点（与前一个兄弟节点交换位置）
 * @param obj 目标节点
 */
export function moveUpObj(obj: NodeObj) {
  const { siblings, index } = getSibling(obj)
  if (siblings === undefined) return
  const t = siblings[index]
  if (index === 0) {
    // 如果是第一个，移到最后一个（循环移动）
    siblings[index] = siblings[siblings.length - 1]
    siblings[siblings.length - 1] = t
  } else {
    // 否则与前一个交换
    siblings[index] = siblings[index - 1]
    siblings[index - 1] = t
  }
}

/**
 * 向下移动节点（与后一个兄弟节点交换位置）
 * @param obj 目标节点
 */
export function moveDownObj(obj: NodeObj) {
  const { siblings, index } = getSibling(obj)
  if (siblings === undefined) return
  const t = siblings[index]
  if (index === siblings.length - 1) {
    // 如果是最后一个，移到第一个（循环移动）
    siblings[index] = siblings[0]
    siblings[0] = t
  } else {
    // 否则与后一个交换
    siblings[index] = siblings[index + 1]
    siblings[index + 1] = t
  }
}

/**
 * 从父节点的子列表中移除节点
 * @param obj 要移除的节点
 * @returns 移除后兄弟节点的数量
 */
export function removeNodeObj(obj: NodeObj) {
  const { siblings, index } = getSibling(obj)
  if (siblings === undefined) return 0
  siblings.splice(index, 1)
  return siblings.length
}

/**
 * 在目标节点的前或后插入新节点
 * @param newObj 新节点对象
 * @param type 插入位置：'before' (前) 或 'after' (后)
 * @param obj 参考节点
 */
export function insertNodeObj(newObj: NodeObj, type: 'before' | 'after', obj: NodeObj) {
  const { siblings, index } = getSibling(obj)
  if (siblings === undefined) return
  if (type === 'before') {
    siblings.splice(index, 0, newObj)
  } else {
    siblings.splice(index + 1, 0, newObj)
  }
}

/**
 * 为当前节点插入一个新的父节点（当前节点变为新节点的子节点）
 * @param obj 当前节点
 * @param newObj 新的父节点
 */
export function insertParentNodeObj(obj: NodeObj, newObj: NodeObj) {
  const { siblings, index } = getSibling(obj)
  if (siblings === undefined) return
  // 在原位置替换为新节点
  siblings[index] = newObj
  // 将原节点设为新节点的子节点
  newObj.children = [obj]
}

/**
 * 移动节点到新的位置
 * @param type 移动类型：'in' (作为子节点), 'before' (作为前兄弟), 'after' (作为后兄弟)
 * @param from 要移动的节点
 * @param to 目标参照节点
 */
export function moveNodeObj(type: 'in' | 'before' | 'after', from: NodeObj, to: NodeObj) {
  // 先从原位置移除
  removeNodeObj(from)
  
  // 如果目标节点是根节点或者第一层节点，可能需要调整方向
  if (!to.parent?.parent) {
    from.direction = to.direction
  }
  
  if (type === 'in') {
    // 移动到目标节点内部成为子节点
    if (to.children) to.children.push(from)
    else to.children = [from]
  } else {
    // 移动到目标节点旁边（前或后）
    if (from.direction !== undefined) from.direction = to.direction
    const { siblings, index } = getSibling(to)
    if (siblings === undefined) return
    if (type === 'before') {
      siblings.splice(index, 0, from)
    } else {
      siblings.splice(index + 1, 0, from)
    }
  }
}

