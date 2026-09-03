/**
 * @file 交互门禁 - 判断当前是否允许刷新
 *
 * 中文说明：
 * - 当用户处于输入/拖拽/框选/pan 等交互状态时，禁止刷新
 * - 刷新必须延迟到交互结束，避免打断用户操作
 *
 * 设计原则：
 * - 只做状态检测，不做任何副作用
 * - 所有状态来源必须明确（mindmapStore / MindMapInstance）
 * - 禁止推测或防御性判断
 *
 * @see packages/plugins/mindmap/src/renderer/features/autoRefresh/README.md
 */

import type { MindMapInstance } from '../../../domain/types'
import { useMindMapStore } from '../../../domain/store/mindmapStore'
import type { GateCheckResult, GateBlockReason } from '../domain/types'
import { LOG_PREFIX } from '../domain/types'

// =========================================================================
// 状态检测函数（各交互类型独立检测）
// =========================================================================

/**
 * 检测是否处于编辑状态
 *
 * 中文说明：
 * - 依赖 mindmapStore.isEditingInput 作为权威信号
 * - NodeEditor 打开时会设置此状态为 true
 */
function isEditing(): boolean {
  const store = useMindMapStore()
  return store.isEditingInput
}

/**
 * 检测是否处于节点拖拽状态
 *
 * 中文说明：
 * - 依赖 MindMapInstance.dragged 字段
 * - 节点拖拽开始时 dragged 被设置为非空数组
 */
function isDraggingNode(mind: MindMapInstance | null): boolean {
  if (!mind) return false
  /**
   * 根因说明：
   * - 类型契约：MindMapInstance.dragged 应为 `Topic[] | null`
   * - 但在开发期热更新/旧实例残留等场景下，运行时可能出现 `undefined`
   * - 门禁属于“不可中断链路”，这里必须保证不抛异常，否则会直接中断自动刷新
   *
   * 约束：
   * - 不做推测式修复：仅做结构化判定
   * - 非数组且非 null 的值一律视为“未处于拖拽中”
   */
  const dragged = mind.dragged
  if (dragged === null) return false
  return Array.isArray(dragged) && dragged.length > 0
}

/**
 * 检测是否处于框选状态
 *
 * 中文说明：
 * - 依赖 SelectionArea 暴露的只读观测口径 `isAreaDragging`
 * - 当用户拖拽框选框时该值为 true
 */
function isSelectingRect(mind: MindMapInstance | null): boolean {
  if (!mind || !mind.selection) return false
  return mind.selection.isAreaDragging === true
}

/**
 * 检测是否处于画布拖拽（pan）状态
 *
 * 中文说明：
 * - 依赖 dragMoveHelper.mousedown 字段
 * - 当用户按住鼠标拖动画布时此值为 true
 */
function isPanning(mind: MindMapInstance | null): boolean {
  if (!mind) return false
  return mind.dragMoveHelper.mousedown === true
}

/**
 * 检测是否处于移动模式
 *
 * 中文说明：
 * - 依赖 mindmapStore.moveMode
 * - 用户开启移动模式时，画布处于特殊交互状态
 */
function isInMoveMode(): boolean {
  const store = useMindMapStore()
  return store.moveMode
}

// =========================================================================
// 门禁主入口
// =========================================================================

/**
 * 检查是否允许刷新
 *
 * 中文说明：
 * - 综合检测所有交互状态
 * - 返回结构化结果，包含是否允许和阻塞原因
 *
 * @param mind MindMapInstance 实例（可能为 null）
 * @returns 门禁检查结果
 */
export function checkRefreshAllowed(mind: MindMapInstance | null): GateCheckResult {
  const blockReasons: GateBlockReason[] = []

  // 1. 检测编辑状态
  if (isEditing()) {
    blockReasons.push('editing')
  }

  // 2. 检测节点拖拽
  if (isDraggingNode(mind)) {
    blockReasons.push('dragging')
  }

  // 3. 检测框选
  if (isSelectingRect(mind)) {
    blockReasons.push('selecting')
  }

  // 4. 检测画布拖拽
  if (isPanning(mind)) {
    blockReasons.push('panning')
  }

  // 5. 检测移动模式
  if (isInMoveMode()) {
    blockReasons.push('moveMode')
  }

  const allowed = blockReasons.length === 0

  return { allowed, blockReasons }
}

/**
 * 创建可观测的门禁检查（带日志）
 *
 * 中文说明：
 * - 对 checkRefreshAllowed 的包装
 * - 当被阻塞时输出日志，便于定位
 *
 * @param mind MindMapInstance 实例
 * @param debug 是否输出调试日志
 */
export function checkRefreshAllowedWithLog(
  mind: MindMapInstance | null,
  debug: boolean = false
): GateCheckResult {
  const result = checkRefreshAllowed(mind)

  if (!result.allowed && debug) {
    console.log(
      `${LOG_PREFIX} gated:`,
      result.blockReasons.join(', ')
    )
  }

  return result
}

// =========================================================================
// 交互结束监听（用于延迟刷新的回调注册）
// =========================================================================

/**
 * 交互结束回调类型
 */
export type InteractionEndCallback = () => void

/**
 * 等待交互结束
 *
 * 中文说明：
 * - 当门禁阻塞时，注册一个回调等待交互结束
 * - 使用轮询策略（短间隔）检测交互状态变化
 * - 返回取消函数，允许外部取消等待
 *
 * @param mind MindMapInstance 实例
 * @param callback 交互结束后执行的回调
 * @param options 配置选项
 * @returns 取消等待的函数
 */
export function waitForInteractionEnd(
  mind: MindMapInstance | null,
  callback: InteractionEndCallback,
  options: {
    /** 检测间隔（毫秒），默认 100ms */
    pollInterval?: number
    /** 最大等待时间（毫秒），默认 30s */
    maxWaitTime?: number
    /** 调试日志 */
    debug?: boolean
  } = {}
): () => void {
  const { pollInterval = 100, maxWaitTime = 30000, debug = false } = options

  let cancelled = false
  let pollCount = 0
  const startTime = Date.now()

  const poll = () => {
    if (cancelled) {
      if (debug) {
        console.log(`${LOG_PREFIX} waitForInteractionEnd: cancelled`)
      }
      return
    }

    const elapsed = Date.now() - startTime
    if (elapsed > maxWaitTime) {
      console.warn(
        `${LOG_PREFIX} waitForInteractionEnd: timeout after ${maxWaitTime}ms, forcing callback`
      )
      callback()
      return
    }

    const result = checkRefreshAllowed(mind)
    pollCount++

    if (result.allowed) {
      if (debug) {
        console.log(
          `${LOG_PREFIX} waitForInteractionEnd: gate opened after ${pollCount} polls (${elapsed}ms)`
        )
      }
      callback()
    } else {
      // 继续等待
      setTimeout(poll, pollInterval)
    }
  }

  // 启动轮询
  setTimeout(poll, pollInterval)

  // 返回取消函数
  return () => {
    cancelled = true
  }
}
