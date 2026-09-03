import { LEFT, RIGHT, SIDE } from '../../../domain/constants'
import { rmSubline } from '../../../domain/operations/nodeOperations'
import type { MindMapInstance, NodeObj } from '../../../domain/types'
import type { Topic, Wrapper, Expander } from '../../../domain/types/dom'
import { createExpander } from './index'
import { disposeExpander } from './expanderRenderer'

// Judge new added node L or R
export const judgeDirection = function ({ map, direction }: MindMapInstance, obj: NodeObj) {
  if (direction === LEFT) {
    return LEFT
  } else if (direction === RIGHT) {
    return RIGHT
  } else if (direction === SIDE) {
    const l = map.querySelector('.lhs')?.childElementCount || 0
    const r = map.querySelector('.rhs')?.childElementCount || 0
    if (l <= r) {
      obj.direction = LEFT
      return LEFT
    } else {
      obj.direction = RIGHT
      return RIGHT
    }
  }
}

export const addChildDom = function (mind: MindMapInstance, to: Topic, wrapper: Wrapper) {
  const tpc = wrapper.children[0].children[0] as Topic
  const top = to.parentElement
  if (top.tagName === 'MM-NODE') {
    rmSubline(tpc)
    if (top.children[1]) {
      top.nextSibling.appendChild(wrapper)
    } else {
      const c = mind.createChildren([wrapper])
      const expander = createExpander(mind, tpc.nodeObj, true)
      top.appendChild(expander)
      tpc.expander = expander
      top.insertAdjacentElement('afterend', c)
    }
    // 中文说明：
    // - 这里属于结构变更导致的几何变化（连线需要重算）
    // - 以前依赖 `wrapper.offsetParent` 做“局部 linkDiv”，但该策略受 CSS 结构影响较大，容易脆弱
    // - 当前阶段优先稳：统一走 ReflowScheduler 做一次全局几何重算（同帧合并）
    mind.requestReflow('node-operation:dom-changed')
  } else if (top.tagName === 'MM-ROOT') {
    const direction = judgeDirection(mind, tpc.nodeObj)
    if (direction === LEFT) {
      mind.container.querySelector('.lhs')?.appendChild(wrapper)
    } else {
      mind.container.querySelector('.rhs')?.appendChild(wrapper)
    }
    // 中文说明：根节点直接挂载子树也会改变连线几何，统一走 ReflowScheduler 调度重算
    mind.requestReflow('node-operation:dom-changed')
  }
}

export const removeNodeDom = function (tpc: Topic, siblingLength: number) {
  const node = tpc.parentNode
  if (!node) return

  const wrapper = node.parentNode as HTMLElement | null
  const childrenContainer = wrapper?.parentNode as HTMLElement | null

  // 检查 mm-children 容器是否还有其他子节点（兄弟节点）
  // 如果有其他兄弟节点的 wrapper 还在 DOM 中，说明还不能清空整个容器
  if (siblingLength === 0 && childrenContainer) {
    if (childrenContainer.tagName !== 'MM-MAIN') {
      // 再次确认容器中是否真的没有子节点了
      // siblingLength 是根据数据层计算的，但 DOM 可能已经被部分删除
      const remainingWrappers = childrenContainer.children.length
      
      if (remainingWrappers === 1) {
        // 只剩下当前要删除的 wrapper，那么整个容器可以清空
        const previous = childrenContainer.previousSibling as HTMLElement | null
        const expander = previous?.children?.[1] as Expander | undefined
        if (expander) {
          disposeExpander(expander)
          expander.remove()
        }
        childrenContainer.remove()
      } else if (remainingWrappers > 1) {
        // 还有其他兄弟节点，只删除当前节点，保留容器
        wrapper?.remove()
        return
      }
    }
  }

  wrapper?.remove()
}
