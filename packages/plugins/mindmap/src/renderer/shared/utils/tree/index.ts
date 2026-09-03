import type { NodeObj, MindMapInstance, NodeObjExport } from '../../../domain/types/index'
import { generateUUID } from '../common/index'

export const getObjById = function (id: string, data: NodeObj): NodeObj | null {
  if (data.id === id) {
    return data
  } else if (data.children && data.children.length) {
    for (let i = 0; i < data.children.length; i++) {
      const res = getObjById(id, data.children[i])
      if (res) return res
    }
    return null
  } else {
    return null
  }
}

/**
 * Add parent property to every node
 */
export const fillParent = (data: NodeObj, parent?: NodeObj) => {
  data.parent = parent
  if (data.children) {
    for (let i = 0; i < data.children.length; i++) {
      fillParent(data.children[i], data)
    }
  }
}

export const setExpand = (node: NodeObj, isExpand: boolean, level?: number) => {
  node.expanded = isExpand
  if (node.children) {
    if (level === undefined || level > 0) {
      const nextLevel = level !== undefined ? level - 1 : undefined
      node.children.forEach(child => {
        setExpand(child, isExpand, nextLevel)
      })
    } else {
      node.children.forEach(child => {
        setExpand(child, false)
      })
    }
  }
}

export function refreshIds(data: NodeObj) {
  data.id = generateUUID()
  if (data.children) {
    for (let i = 0; i < data.children.length; i++) {
      refreshIds(data.children[i])
    }
  }
}

/**
 * 生成新节点对象
 * 所有新建的节点（除了 root 之外）都使用"子主题"作为占位符
 */
export const generateNewObj = function (this: MindMapInstance): NodeObjExport {
  const id = generateUUID()
  return {
    topic: '子主题',
    id,
  }
}

export function checkMoveValid(from: NodeObj, to: NodeObj) {
  let valid = true
  while (to.parent) {
    if (to.parent === from) {
      valid = false
      break
    }
    to = to.parent
  }
  return valid
}

export function deepClone(obj: NodeObj) {
  const deepCloneObj = JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (k === 'parent') return undefined
      return v
    })
  )
  return deepCloneObj
}

