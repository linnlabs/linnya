import type { Topic } from '../../domain/types/dom'
import type { KeypressOptions, MindMapInstance } from '../../domain/types/index'
import { DirectionClass } from '../../domain/types/index'
import { setExpand } from '../utils/tree/index'

// ============================================================================
// 键盘导航（空间选点算法）
//
// 中文说明：
// - shared/hotkeys 是历史入口，但仍可能被其它路径/测试使用。
// - 为保证体验一致，这里与 `interaction/keyboard/defaultKeymap.ts` 保持同算法口径：
//   使用“锚点 X（列记忆）+ 锥体筛选 + 矩形边界距离”来实现上下方向键导航。
// ============================================================================

type NavAxis = 'vertical' | 'horizontal'
interface KeyboardNavState {
  anchorX: number | null
  lastAxis: NavAxis | null
}

const keyboardNavState = new WeakMap<MindMapInstance, KeyboardNavState>()

const getOrCreateKeyboardNavState = (mind: MindMapInstance): KeyboardNavState => {
  const existing = keyboardNavState.get(mind)
  if (existing) return existing
  const created: KeyboardNavState = { anchorX: null, lastAxis: null }
  keyboardNavState.set(mind, created)
  return created
}

const resetKeyboardNavStateToAxis = (mind: MindMapInstance, axis: NavAxis) => {
  const state = getOrCreateKeyboardNavState(mind)
  state.lastAxis = axis
  if (axis !== 'vertical') {
    state.anchorX = null
  }
}

const distanceToHorizontalInterval = (x: number, left: number, right: number): number => {
  if (x < left) return left - x
  if (x > right) return x - right
  return 0
}

type VerticalDirection = 'up' | 'down'
type VerticalCandidateMetricMode = 'edge' | 'center'

interface CandidateMetrics {
  dy: number
  dx: number
  distance: number
}

const getVerticalCandidateMetrics = (
  direction: VerticalDirection,
  mode: VerticalCandidateMetricMode,
  currentRect: DOMRect,
  currentCenterY: number,
  anchorX: number,
  candidateRect: DOMRect
): CandidateMetrics | null => {
  const candidateCenterY = candidateRect.top + candidateRect.height / 2
  const dy =
    mode === 'edge'
      ? direction === 'up'
        ? currentRect.top - candidateRect.bottom
        : candidateRect.top - currentRect.bottom
      : direction === 'up'
        ? currentCenterY - candidateCenterY
        : candidateCenterY - currentCenterY

  if (dy <= 1) return null

  const dx = distanceToHorizontalInterval(anchorX, candidateRect.left, candidateRect.right)
  const distance = Math.hypot(dy, dx)
  return { dy, dx, distance }
}

const isBetterCandidate = (a: CandidateMetrics, b: CandidateMetrics): boolean => {
  if (a.dy !== b.dy) return a.dy < b.dy
  if (a.dx !== b.dx) return a.dx < b.dx
  return a.distance < b.distance
}

const pickNearestByVerticalDirection = (
  mind: MindMapInstance,
  current: Topic,
  direction: VerticalDirection
): boolean => {
  const currentRect = current.getBoundingClientRect()
  const currentCenterY = currentRect.top + currentRect.height / 2
  const currentCenterX = currentRect.left + currentRect.width / 2

  const state = getOrCreateKeyboardNavState(mind)
  if (state.lastAxis !== 'vertical' || state.anchorX == null) {
    state.lastAxis = 'vertical'
    state.anchorX = currentCenterX
  }
  const anchorX = state.anchorX

  const scope = current.closest('mm-main') ?? mind.map
  const topics = Array.from(scope.querySelectorAll('mm-topic')) as Topic[]

  const coneTanStrict = 1.0
  const coneTanRelaxed = 2.0

  const tryPick = (mode: VerticalCandidateMetricMode, coneTan: number | null): Topic | null => {
    let best: { topic: Topic; metrics: CandidateMetrics } | null = null
    for (const topic of topics) {
      if (topic === current) continue
      const rect = topic.getBoundingClientRect()
      const metrics = getVerticalCandidateMetrics(
        direction,
        mode,
        currentRect,
        currentCenterY,
        anchorX,
        rect
      )
      if (!metrics) continue
      if (coneTan != null && metrics.dx > metrics.dy * coneTan) continue
      if (!best || isBetterCandidate(metrics, best.metrics)) {
        best = { topic, metrics }
      }
    }
    return best?.topic ?? null
  }

  const edgeStrict = tryPick('edge', coneTanStrict)
  if (edgeStrict) {
    mind.selectNode(edgeStrict)
    return true
  }

  const edgeRelaxed = tryPick('edge', coneTanRelaxed)
  if (edgeRelaxed) {
    mind.selectNode(edgeRelaxed)
    return true
  }

  const centerRelaxed = tryPick('center', coneTanRelaxed)
  if (centerRelaxed) {
    mind.selectNode(centerRelaxed)
    return true
  }

  return false
}

const selectRootLeft = (mind: MindMapInstance) => {
  const tpcs = mind.map.querySelectorAll('.lhs>mm-wrapper>mm-node>mm-topic')
  // 中文说明：
  // - SIDE/RIGHT 模式下可能不存在 lhs 节点（例如全部在右侧）
  // - 之前这里强制类型断言会把 undefined 当成 Topic 传入，最终在 scrollIntoView 中崩溃
  if (tpcs.length === 0) return
  const target = tpcs[Math.ceil(tpcs.length / 2) - 1]
  if (!target) return
  mind.selectNode(target as Topic)
}

const selectRootRight = (mind: MindMapInstance) => {
  const tpcs = mind.map.querySelectorAll('.rhs>mm-wrapper>mm-node>mm-topic')
  // 中文说明：同 selectRootLeft，右侧也可能为空（例如全部在左侧）
  if (tpcs.length === 0) return
  const target = tpcs[Math.ceil(tpcs.length / 2) - 1]
  if (!target) return
  mind.selectNode(target as Topic)
}

const selectRoot = (mind: MindMapInstance) => {
  const root = mind.map.querySelector('mm-root>mm-topic')
  if (!root) return
  mind.selectNode(root as Topic)
}

const selectParent = (mind: MindMapInstance, currentNode: Topic) => {
  const parent = currentNode.parentElement?.parentElement?.parentElement?.previousSibling
  if (parent?.firstChild) {
    const target = parent.firstChild as Topic
    mind.selectNode(target)
  }
}

const selectFirstChild = (mind: MindMapInstance, currentNode: Topic) => {
  const children = currentNode.parentElement?.nextSibling
  if (children?.firstChild) {
    const target = (children.firstChild as HTMLElement).firstChild?.firstChild as Topic | null
    if (target) mind.selectNode(target)
  }
}

const handleLeftRight = (mind: MindMapInstance, direction: DirectionClass) => {
  const current = mind.currentNode || mind.currentNodes?.[0]
  if (!current) return
  const nodeObj = current.nodeObj
  const main = current.offsetParent?.offsetParent?.parentElement
  resetKeyboardNavStateToAxis(mind, 'horizontal')
  if (!nodeObj.parent) {
    direction === DirectionClass.LEFT ? selectRootLeft(mind) : selectRootRight(mind)
  } else if (main?.className === direction) {
    selectFirstChild(mind, current)
  } else if (!nodeObj.parent?.parent) {
    selectRoot(mind)
  } else {
    selectParent(mind, current)
  }
}

const getWrapper = (topic: Topic) => topic.parentElement?.parentElement as HTMLElement | null

const getWrapperTopic = (wrapper: HTMLElement | null) => {
  if (!wrapper) return null
  const node = wrapper.firstElementChild
  if (!node || node.tagName !== 'MM-NODE') return null
  const topic = node.firstElementChild
  return topic && topic.tagName === 'MM-TOPIC' ? (topic as Topic) : null
}

const handleVerticalNavigation = (mind: MindMapInstance, direction: 'up' | 'down') => {
  const current = mind.currentNode
  if (!current) return
  const wrapper = getWrapper(current)
  if (!wrapper) return

  if (direction === 'up') {
    const prevWrapper = wrapper.previousElementSibling as HTMLElement | null
    const prevTarget = getWrapperTopic(prevWrapper)
    if (prevTarget) {
      resetKeyboardNavStateToAxis(mind, 'vertical')
      mind.selectNode(prevTarget)
      return
    }
    if (pickNearestByVerticalDirection(mind, current, 'up')) return
  } else {
    const nextWrapper = wrapper.nextElementSibling as HTMLElement | null
    const nextTarget = getWrapperTopic(nextWrapper)
    if (nextTarget) {
      resetKeyboardNavStateToAxis(mind, 'vertical')
      mind.selectNode(nextTarget)
      return
    }
    if (pickNearestByVerticalDirection(mind, current, 'down')) return
  }

  mind.selectNode(current)
}

export const handleZoom = (
  mind: MindMapInstance,
  direction: 'in' | 'out',
  offset?: { x: number; y: number }
) => {
  const { scaleVal, scaleSensitivity } = mind
  if (direction === 'in') {
    mind.scale(scaleVal + scaleSensitivity, offset)
  } else {
    mind.scale(scaleVal - scaleSensitivity, offset)
  }
}

export type HotkeyHandler = (e: KeyboardEvent) => void
export type HotkeyMap = Record<string, HotkeyHandler>

export const createDefaultHotkeyMap = (
  mind: MindMapInstance,
  options: boolean | KeypressOptions = true
): HotkeyMap => {
  const extras = options === true ? {} : options

  /**
   * 删除处理：统一入口
   *
   * 中文说明：
   * - 优先检测 arrow/summary 的单独删除（暂不走命令系统）
   * - 节点删除通过 commands.node.removeSelected 执行
   * - source='hotkey' 用于可观测性追踪
   */
  const handleRemove = () => {
    if (mind.currentArrow) {
      mind.removeArrow()
    } else if (mind.currentSummary) {
      mind.removeSummary(mind.currentSummary.summaryObj.id)
    } else if (mind.currentNodes && mind.currentNodes.length > 0) {
      // 通过命令系统删除节点
      mind.commands.node.removeSelected({}, { source: 'hotkey' })
    }
  }

  // Track key sequence for Ctrl+K+Ctrl+0
  let ctrlKPressed = false
  let ctrlKTimeout: number | null = null
  const handleControlKPlusX = (e: KeyboardEvent) => {
    const nodeData = mind.nodeData
    if (e.key === '0') {
      // Ctrl+K+Ctrl+0: Collapse all nodes
      nodeData.children?.forEach(node => setExpand(node, false))
    }
    if (e.key === '=') {
      // Ctrl+K+Ctrl+1: Expand all nodes
      nodeData.children?.forEach(node => setExpand(node, true))
    }
    if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
      nodeData.children?.forEach(node => setExpand(node, true, Number(e.key) - 1))
    }
    mind.refresh()
    mind.toCenter()

    ctrlKPressed = false
    if (ctrlKTimeout) {
      clearTimeout(ctrlKTimeout)
      ctrlKTimeout = null
      mind.container.removeEventListener('keydown', handleControlKPlusX)
    }
  }

  const handleSpace: HotkeyHandler = e => {
    if (mind.currentSummary) {
      mind.editSummary(mind.currentSummary)
    } else if (mind.currentArrow) {
      mind.editArrowLabel(mind.currentArrow)
    } else {
      mind.beginEdit()
    }
    // 避免触发空格拖拽状态
    mind.spacePressed = false
    mind.container.classList.remove('space-pressed')
    e.stopImmediatePropagation?.()
  }

  const key2func: HotkeyMap = {
    /**
     * Enter：插入兄弟节点 / 插入父节点
     *
     * 中文说明：
     * - Shift+Enter: 在前插入兄弟
     * - Ctrl/Cmd+Enter: 插入父节点
     * - Enter: 在后插入兄弟
     * - 通过命令系统执行，source='hotkey'
     */
    Enter: e => {
      const nodeId = mind.currentNode?.nodeObj?.id
      if (!nodeId) return

      if (e.shiftKey) {
        mind.commands.node.insertSiblingBefore({ nodeId, edit: false }, { source: 'hotkey' })
      } else if (e.ctrlKey || e.metaKey) {
        mind.commands.node.insertParent({ nodeId, edit: false }, { source: 'hotkey' })
      } else {
        mind.commands.node.insertSiblingAfter({ nodeId, edit: false }, { source: 'hotkey' })
      }
    },
    /**
     * Tab：添加子节点
     *
     * 中文说明：
     * - 通过命令系统执行，source='hotkey'
     */
    Tab: () => {
      const nodeId = mind.currentNode?.nodeObj?.id
      if (!nodeId) return
      mind.commands.node.addChild({ nodeId, edit: false }, { source: 'hotkey' })
    },
    ' ': handleSpace,
    Spacebar: handleSpace,
    F1: () => {
      mind.toCenter()
    },
    F2: () => {
      if (mind.currentSummary) {
        mind.editSummary(mind.currentSummary)
      } else if (mind.currentArrow) {
        mind.editArrowLabel(mind.currentArrow)
      } else {
        mind.beginEdit()
      }
    },
    ArrowUp: e => {
      if (e.altKey) {
        mind.moveUpNode()
      } else if (e.metaKey || e.ctrlKey) {
        mind.initSide()
      } else {
        handleVerticalNavigation(mind, 'up')
      }
    },
    ArrowDown: e => {
      if (e.altKey) {
        mind.moveDownNode()
      } else {
        handleVerticalNavigation(mind, 'down')
      }
    },
    ArrowLeft: e => {
      if (e.metaKey || e.ctrlKey) {
        mind.initLeft()
        return
      }
      handleLeftRight(mind, DirectionClass.LEFT)
    },
    ArrowRight: e => {
      if (e.metaKey || e.ctrlKey) {
        mind.initRight()
        return
      }
      handleLeftRight(mind, DirectionClass.RIGHT)
    },
    PageUp: () => {
      mind.moveUpNode()
    },
    PageDown: () => {
      mind.moveDownNode()
    },
    c: e => {
      if (e.metaKey || e.ctrlKey) {
        mind.waitCopy = mind.currentNodes
      }
    },
    x: e => {
      if (e.metaKey || e.ctrlKey) {
        mind.waitCopy = mind.currentNodes
        handleRemove()
      }
    },
    v: e => {
      if (!mind.waitCopy || !mind.currentNode) return
      if (e.metaKey || e.ctrlKey) {
        if (mind.waitCopy.length === 1) {
          mind.copyNode(mind.waitCopy[0], mind.currentNode)
        } else {
          mind.copyNodes(mind.waitCopy, mind.currentNode)
        }
      }
    },
    '=': e => {
      if (e.metaKey || e.ctrlKey) {
        handleZoom(mind, 'in')
      }
    },
    '-': e => {
      if (e.metaKey || e.ctrlKey) {
        handleZoom(mind, 'out')
      }
    },
    '0': e => {
      if (e.metaKey || e.ctrlKey) {
        if (ctrlKPressed) return
        mind.scale(1)
      }
    },
    k: e => {
      if (e.metaKey || e.ctrlKey) {
        ctrlKPressed = true
        if (ctrlKTimeout) {
          clearTimeout(ctrlKTimeout)
          mind.container.removeEventListener('keydown', handleControlKPlusX)
        }
        ctrlKTimeout = window.setTimeout(() => {
          ctrlKPressed = false
          ctrlKTimeout = null
        }, 2000)
        mind.container.addEventListener('keydown', handleControlKPlusX)
      }
    },
    Delete: handleRemove,
    Backspace: handleRemove,
  }

  return {
    ...key2func,
    ...extras,
  }
}
