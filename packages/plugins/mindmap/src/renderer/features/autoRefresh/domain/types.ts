/**
 * @file 自动刷新 Feature 的类型定义
 *
 * 中文说明：
 * - 统一定义自动刷新相关的所有接口与类型
 * - 确保编排器、门禁、快照模块间的类型一致性
 *
 * @see packages/plugins/mindmap/src/renderer/features/autoRefresh/README.md
 */

// =========================================================================
// 刷新请求相关
// =========================================================================

/**
 * 刷新原因（来源分类）
 *
 * 中文说明：
 * - 用于可观测日志，帮助定位"为什么触发刷新"
 */
export type RefreshReason =
  | 'push:document_updated'   // 后端推送文档更新通知
  | 'poll:version_changed'    // 轮询发现版本变化（兜底）
  | 'manual'                  // 手动触发（调试用）

/**
 * 刷新请求参数
 */
export interface RefreshRequest {
  /** 目标文档 ID */
  documentId: string
  /** 刷新原因 */
  reason: RefreshReason
  /** 触发来源工具名（可选，用于日志） */
  sourceTool?: string
  /** 目标版本号（可选，来自工具返回） */
  versionNumber?: number
  /** 请求时间戳 */
  requestedAt: number
}

// =========================================================================
// 交互门禁相关
// =========================================================================

/**
 * 门禁阻塞原因
 *
 * 中文说明：
 * - 当前处于哪种交互状态导致刷新被延迟
 */
export type GateBlockReason =
  | 'editing'     // NodeEditor 输入中
  | 'dragging'    // 节点拖拽中
  | 'selecting'   // 框选中
  | 'panning'     // 画布拖拽中
  | 'moveMode'    // 移动模式开启

/**
 * 门禁检查结果
 */
export interface GateCheckResult {
  /** 是否允许刷新 */
  allowed: boolean
  /** 阻塞原因列表（allowed=false 时有值） */
  blockReasons: GateBlockReason[]
}

// =========================================================================
// 快照相关
// =========================================================================

/**
 * Viewport 快照
 */
export interface ViewportSnapshot {
  x: number
  y: number
  scale: number
}

/**
 * 选区快照
 *
 * 中文说明：
 * - 记录选中节点的 ID 列表
 * - 刷新后尝试恢复选区
 */
export interface SelectionSnapshot {
  /** 选中节点 ID 列表 */
  nodeIds: string[]
  /** 最后一个选中节点 ID（当前节点） */
  currentNodeId: string | null
}

/**
 * 专注模式（Focus）快照
 *
 * 中文说明：
 * - MindMap 支持通过 `focusNode()` 聚焦某个节点子树（见 `interaction/dataControls.ts`）
 * - 全量 reload 会重建实例，若不记录该状态会导致用户从“专注视图”被踢回全图
 */
export interface FocusModeSnapshot {
  /** 是否处于专注模式 */
  isFocusMode: boolean
  /** 被聚焦的节点 ID（isFocusMode=true 时应有值） */
  focusedNodeId: string | null
  /** 专注模式下的当前布局方向 */
  direction: 0 | 1 | 2
  /** 进入专注前的布局方向（用于 cancelFocus 时还原） */
  tempDirection: 0 | 1 | 2 | null
}

/**
 * 完整快照（刷新前保存，刷新后尝试恢复）
 */
export interface RefreshSnapshot {
  viewport: ViewportSnapshot
  selection: SelectionSnapshot
  focusMode: FocusModeSnapshot
  /** 快照时间戳 */
  takenAt: number
}

// =========================================================================
// 服务状态相关
// =========================================================================

/**
 * 待处理刷新请求（合并后的状态）
 */
export interface PendingRefresh {
  /** 目标文档 ID */
  documentId: string
  /** 合并的刷新原因列表 */
  reasons: RefreshReason[]
  /** 最新版本号（取最大值） */
  latestVersionNumber?: number
  /** 首次请求时间 */
  firstRequestedAt: number
  /** 最后请求时间 */
  lastRequestedAt: number
  /** 合并计数 */
  coalescedCount: number
}

/**
 * 刷新执行结果
 */
export interface RefreshResult {
  success: boolean
  /** 文档 ID */
  documentId: string
  /** 耗时（毫秒） */
  durationMs: number
  /** 错误信息（失败时） */
  error?: string
  /** 快照恢复是否成功 */
  snapshotRestored: boolean
  /** 恢复失败原因 */
  restoreFailReason?: string
}

// =========================================================================
// 日志相关
// =========================================================================

/**
 * 日志级别
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

/**
 * 自动刷新日志前缀
 */
export const LOG_PREFIX = '[MindMapAutoRefresh]' as const
