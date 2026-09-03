/**
 * MindMap 键盘导航（方向键）实现
 *
 * 中文说明：
 * - 本文件只负责“上下左右如何选中哪个节点”的导航算法与辅助函数。
 * - `defaultKeymap.ts` 只负责快捷键表与调用，避免文件过长、职责混杂。
 * - 这里的上下导航采用“空间选点算法”（更接近 XMind 的直觉体验）：
 *   - 方向正确（上/下）
 *   - 尽量保持水平对齐（锚点 X / 列记忆）
 *   - 优先选择更近的候选（矩形边界距离优先，中心点兜底）
 */

import type { MindMapInstance } from '../../domain/types'
import type { Topic } from '../../domain/types/dom'
import { DirectionClass, type DirectionClass as DirectionClassType } from '../../domain/types'

// ============================================================================
// DOM 辅助：从 wrapper 找到 topic
// ============================================================================

const getWrapper = (topic: Topic) => topic.parentElement?.parentElement as HTMLElement | null

const getWrapperTopic = (wrapper: HTMLElement | null) => {
  if (!wrapper) return null
  const node = wrapper.firstElementChild
  if (!node || node.tagName !== 'MM-NODE') return null
  const topic = node.firstElementChild
  return topic && topic.tagName === 'MM-TOPIC' ? (topic as Topic) : null
}

// ============================================================================
// 上下导航：空间选点算法（列记忆 + 锥体筛选 + 边界距离）
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
    // 中文说明：左右/其它动作会打断“列记忆”
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

  // 中文说明：方向不正确 / 没有“明显”跨越，直接排除
  if (dy <= 1) return null

  const dx = distanceToHorizontalInterval(anchorX, candidateRect.left, candidateRect.right)
  const distance = Math.hypot(dy, dx)
  return { dy, dx, distance }
}

const isBetterCandidate = (a: CandidateMetrics, b: CandidateMetrics): boolean => {
  // 中文说明：优先 dy（方向距离更近），其次 dx（更对齐），最后综合距离
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

  // 中文说明：
  // - 严格锥体：减少“跨分支很远但 dy 很小”的跳转
  // - 宽松锥体：在严格锥体找不到候选时兜底（避免完全不能移动）
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

      // 中文说明：锥体过滤。dx 太大、相对 dy 角度过斜时，认为“不是这个方向的直觉候选”
      if (coneTan != null && metrics.dx > metrics.dy * coneTan) continue

      if (!best || isBetterCandidate(metrics, best.metrics)) {
        best = { topic, metrics }
      }
    }
    return best?.topic ?? null
  }

  // 优先：用边界 dy（更符合“大节点”的视觉距离）
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

  // 兜底：如果节点之间有重叠导致 edge dy 为负/0，则回退到 center dy
  const centerRelaxed = tryPick('center', coneTanRelaxed)
  if (centerRelaxed) {
    mind.selectNode(centerRelaxed)
    return true
  }

  return false
}

export function handleVerticalNavigation(mind: MindMapInstance, direction: VerticalDirection): void {
  const current = mind.currentNode
  if (!current) return
  const wrapper = getWrapper(current)
  if (!wrapper) return

  if (direction === 'up') {
    const prevWrapper = wrapper.previousElementSibling as HTMLElement | null
    const prevTarget = getWrapperTopic(prevWrapper)
    if (prevTarget) {
      // 中文说明：同一父容器下的上下兄弟，属于最符合直觉的“视觉相邻”
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

// ============================================================================
// 左右导航：结构化导航（父/子/根）
// ============================================================================

const selectRootLeft = (mind: MindMapInstance) => {
  const tpcs = mind.map.querySelectorAll('.lhs>mm-wrapper>mm-node>mm-topic')
  if (tpcs.length === 0) return
  const target = tpcs[Math.ceil(tpcs.length / 2) - 1]
  if (!target) return
  mind.selectNode(target as Topic)
}

const selectRootRight = (mind: MindMapInstance) => {
  const tpcs = mind.map.querySelectorAll('.rhs>mm-wrapper>mm-node>mm-topic')
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

export function handleLeftRight(mind: MindMapInstance, direction: DirectionClassType): void {
  const current = mind.currentNode || mind.currentNodes?.[0]
  if (!current) return
  const nodeObj = current.nodeObj
  const main = current.offsetParent?.offsetParent?.parentElement

  // 中文说明：左右切换时重置“列记忆”，避免污染下一次上下移动
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

