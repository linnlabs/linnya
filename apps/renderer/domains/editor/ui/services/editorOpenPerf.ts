/**
 * editorOpenPerf.ts
 *
 * 编辑器首开性能指标采集服务。
 *
 * 设计原则：
 * - 零外部依赖：不引用 Vue / Tiptap / Store，任何层都可以安全导入
 * - 不可变快照：每次 finalize 返回一份冻结的指标副本
 * - 单会话语义：每次打开文档调用 reset()，结束时调用 finalize()
 * - 只采集、不判断：不包含任何阈值判断或 UI 反馈逻辑
 */

import { sampleEditorMemory } from './editorMemoryPerf'

// ==================== 类型定义 ====================

/** 首开链路中各阶段的耗时（毫秒） */
export interface EditorOpenTimings {
  /** IPC read-document 耗时 */
  readDocumentMs: number | null
  /** Markdown 首开规范化耗时（仅当触发了 WASM 迁移时有值） */
  markdownNormalizeMs: number | null
  /** editor.commands.setContent 耗时 */
  setContentMs: number | null
  /** setContent 内部 EditorView.updateState 耗时，主要反映 ProseMirror DOM 更新 */
  setContentViewUpdateMs: number | null
  /** setContent 总耗时扣除 updateState 后的剩余开销 */
  setContentNonViewUpdateMs: number | null
  /** JSON content 转 ProseMirror doc 的耗时 */
  setContentNodeFromJsonMs: number | null
  /** 基于新 doc 重建 EditorState 的耗时 */
  setContentStateCreateMs: number | null
  /** pending revisions 注入耗时 */
  pendingRevisionInjectMs: number | null
  /** 从 loadDocumentFromDatabase 被调用到全部完成的端到端耗时 */
  totalLoadMs: number | null
  /** 从 Editor onCreate 到首屏可交互（聚焦完成）的耗时 */
  editorReadyMs: number | null
}

/** 首开快照中的文档维度信息 */
export interface EditorOpenDocInfo {
  /** 文档 rootBlock 总数 */
  rootBlockCount: number
  /** 是否包含 pending revisions */
  hasPendingRevisions: boolean
  /** pending revisions 数量 */
  pendingRevisionCount: number
}

/** NodeView 创建统计 */
export interface NodeViewStats {
  /** 累计创建的 rootBlock NodeView 数量 */
  rootBlockNodeViewCount: number
  /** 使用 Vue BlockView 创建的 rootBlock NodeView 数量 */
  rootBlockVueNodeViewCount: number
  /** 使用原生 Shell 创建的 rootBlock NodeView 数量 */
  rootBlockShellNodeViewCount: number
  /** 使用原生 DOM hydrated 创建的 rootBlock NodeView 数量 */
  rootBlockDomNodeViewCount: number
  /** 使用无 contentDOM placeholder 创建的 rootBlock NodeView 数量 */
  rootBlockPlaceholderNodeViewCount: number
  /** Vue BlockView 创建累计耗时 */
  rootBlockVueNodeViewCreateMs: number
  /** 原生 Shell 创建累计耗时 */
  rootBlockShellNodeViewCreateMs: number
  /** 原生 DOM hydrated 创建累计耗时 */
  rootBlockDomNodeViewCreateMs: number
  /** placeholder NodeView 创建累计耗时 */
  rootBlockPlaceholderNodeViewCreateMs: number
}

/** setContent 内部诊断信息 */
export interface SetContentStats {
  /** 本次加载使用的内容替换策略 */
  method: 'unknown' | 'command' | 'direct-state'
  /** setContent 期间 EditorView.updateState 调用次数 */
  viewUpdateCount: number
  /** direct-state 是否复用了上一份 plugins 数组引用 */
  directStatePluginsStabilized: boolean | null
  /** direct-state 是否在离线 DOM 上完成 view.update */
  directStateDomDetached: boolean | null
  /** detached DOM 摘下耗时 */
  directStateDomDetachMs: number | null
  /** detached DOM 挂回耗时 */
  directStateDomReattachMs: number | null
}

export interface SetContentMetrics {
  method: SetContentStats['method']
  totalMs: number
  viewUpdateMs: number
  nonViewUpdateMs: number
  viewUpdateCount: number
  nodeFromJsonMs?: number | null
  stateCreateMs?: number | null
  directStatePluginsStabilized?: boolean | null
  directStateDomDetached?: boolean | null
  directStateDomDetachMs?: number | null
  directStateDomReattachMs?: number | null
}

/** finalize 后产出的完整快照 */
export interface EditorOpenPerfSnapshot {
  timings: Readonly<EditorOpenTimings>
  docInfo: Readonly<EditorOpenDocInfo>
  nodeViewStats: Readonly<NodeViewStats>
  setContentStats: Readonly<SetContentStats>
  /** 快照生成时刻（Date.now()） */
  timestamp: number
}

// ==================== 内部状态 ====================

let _timings: EditorOpenTimings = createEmptyTimings()
let _docInfo: EditorOpenDocInfo = createEmptyDocInfo()
let _nodeViewStats: NodeViewStats = createEmptyNodeViewStats()
let _setContentStats: SetContentStats = createEmptySetContentStats()

/** 用于 mark/measure 的时间戳暂存 */
const _marks: Map<string, number> = new Map()

// ==================== 工厂函数 ====================

function createEmptyTimings(): EditorOpenTimings {
  return {
    readDocumentMs: null,
    markdownNormalizeMs: null,
    setContentMs: null,
    setContentViewUpdateMs: null,
    setContentNonViewUpdateMs: null,
    setContentNodeFromJsonMs: null,
    setContentStateCreateMs: null,
    pendingRevisionInjectMs: null,
    totalLoadMs: null,
    editorReadyMs: null,
  }
}

function createEmptyDocInfo(): EditorOpenDocInfo {
  return {
    rootBlockCount: 0,
    hasPendingRevisions: false,
    pendingRevisionCount: 0,
  }
}

function createEmptyNodeViewStats(): NodeViewStats {
  return {
    rootBlockNodeViewCount: 0,
    rootBlockVueNodeViewCount: 0,
    rootBlockShellNodeViewCount: 0,
    rootBlockDomNodeViewCount: 0,
    rootBlockPlaceholderNodeViewCount: 0,
    rootBlockVueNodeViewCreateMs: 0,
    rootBlockShellNodeViewCreateMs: 0,
    rootBlockDomNodeViewCreateMs: 0,
    rootBlockPlaceholderNodeViewCreateMs: 0,
  }
}

function createEmptySetContentStats(): SetContentStats {
  return {
    method: 'unknown',
    viewUpdateCount: 0,
    directStatePluginsStabilized: null,
    directStateDomDetached: null,
    directStateDomDetachMs: null,
    directStateDomReattachMs: null,
  }
}

// ==================== 公共 API ====================

/**
 * 重置所有状态。
 * 每次打开新文档前调用。
 */
export function resetOpenPerf(): void {
  _timings = createEmptyTimings()
  _docInfo = createEmptyDocInfo()
  _nodeViewStats = createEmptyNodeViewStats()
  _setContentStats = createEmptySetContentStats()
  _marks.clear()
}

/**
 * 记录一个命名时间戳（高精度）。
 * 后续通过 measure 计算两个 mark 之间的耗时。
 */
export function markPerf(label: string): void {
  _marks.set(label, performance.now())
}

/**
 * 计算两个 mark 之间的耗时，并写入指定的 timings 字段。
 * 如果 startLabel 或 endLabel 不存在，静默跳过。
 */
export function measurePerf(
  startLabel: string,
  endLabel: string,
  field: keyof EditorOpenTimings
): void {
  const start = _marks.get(startLabel)
  const end = _marks.get(endLabel)
  if (start === undefined || end === undefined) return
  _timings[field] = Math.round(end - start)
}

/**
 * 直接设置某个 timings 字段的值。
 * 适用于调用方自己已经计算好耗时的场景。
 */
export function setTimingValue(field: keyof EditorOpenTimings, ms: number): void {
  _timings[field] = Math.round(ms)
}

/**
 * 记录文档维度信息。
 */
export function setDocInfo(info: Partial<EditorOpenDocInfo>): void {
  if (info.rootBlockCount !== undefined) _docInfo.rootBlockCount = info.rootBlockCount
  if (info.hasPendingRevisions !== undefined) _docInfo.hasPendingRevisions = info.hasPendingRevisions
  if (info.pendingRevisionCount !== undefined) _docInfo.pendingRevisionCount = info.pendingRevisionCount
}

/**
 * NodeView 创建时递增计数。
 * 在 RootBlock.addNodeView 中调用。
 */
export function incrementNodeViewCount(
  kind: 'vue' | 'dom' | 'shell' | 'placeholder' = 'vue',
  createMs = 0
): void {
  _nodeViewStats.rootBlockNodeViewCount += 1
  if (kind === 'placeholder') {
    _nodeViewStats.rootBlockPlaceholderNodeViewCount += 1
    _nodeViewStats.rootBlockPlaceholderNodeViewCreateMs += createMs
  } else if (kind === 'dom') {
    _nodeViewStats.rootBlockDomNodeViewCount += 1
    _nodeViewStats.rootBlockDomNodeViewCreateMs += createMs
  } else if (kind === 'shell') {
    _nodeViewStats.rootBlockShellNodeViewCount += 1
    _nodeViewStats.rootBlockShellNodeViewCreateMs += createMs
  } else {
    _nodeViewStats.rootBlockVueNodeViewCount += 1
    _nodeViewStats.rootBlockVueNodeViewCreateMs += createMs
  }
}

/**
 * 记录内容加载的 setContent / direct-state 指标。
 *
 * 中文说明：首开大文档可能走 Tiptap command，也可能走直接重建 EditorState 的快路径；
 * 指标统一收敛到这里，避免两条路径的日志字段不一致。
 */
export function recordSetContentMetrics(metrics: SetContentMetrics): void {
  setTimingValue('setContentMs', metrics.totalMs)
  setTimingValue('setContentViewUpdateMs', metrics.viewUpdateMs)
  setTimingValue('setContentNonViewUpdateMs', metrics.nonViewUpdateMs)

  if (metrics.nodeFromJsonMs !== undefined && metrics.nodeFromJsonMs !== null) {
    setTimingValue('setContentNodeFromJsonMs', metrics.nodeFromJsonMs)
  }
  if (metrics.stateCreateMs !== undefined && metrics.stateCreateMs !== null) {
    setTimingValue('setContentStateCreateMs', metrics.stateCreateMs)
  }

  _setContentStats.method = metrics.method
  _setContentStats.viewUpdateCount = metrics.viewUpdateCount
  _setContentStats.directStatePluginsStabilized = metrics.directStatePluginsStabilized ?? null
  _setContentStats.directStateDomDetached = metrics.directStateDomDetached ?? null
  _setContentStats.directStateDomDetachMs = metrics.directStateDomDetachMs ?? null
  _setContentStats.directStateDomReattachMs = metrics.directStateDomReattachMs ?? null
}

interface EditorViewLike<State = unknown> {
  updateState: (state: State) => void
}

/**
 * 拆分 setContent 耗时。
 *
 * 中文说明：
 * - `editor.commands.setContent(...)` 内部会 dispatch transaction，并触发 `view.updateState`；
 * - 对 10000 块文档，最需要知道的是时间花在 ProseMirror DOM 更新，还是命令/事务本身；
 * - 这里临时包一层 updateState，只记录耗时，不改变语义。
 */
export function measureSetContentOperation<State = unknown>(
  view: EditorViewLike<State> | null | undefined,
  operation: () => void
): void {
  const start = performance.now()
  let viewUpdateMs = 0
  let viewUpdateCount = 0

  if (!view || typeof view.updateState !== 'function') {
    operation()
    const totalMs = performance.now() - start
    recordSetContentMetrics({
      method: 'command',
      totalMs,
      viewUpdateMs: 0,
      nonViewUpdateMs: totalMs,
      viewUpdateCount: 0,
    })
    return
  }

  const originalUpdateState = view.updateState.bind(view)
  view.updateState = (state: unknown) => {
    const updateStart = performance.now()
    try {
      return originalUpdateState(state)
    } finally {
      viewUpdateMs += performance.now() - updateStart
      viewUpdateCount += 1
    }
  }

  try {
    operation()
  } finally {
    view.updateState = originalUpdateState
    const totalMs = performance.now() - start
    recordSetContentMetrics({
      method: 'command',
      totalMs,
      viewUpdateMs,
      nonViewUpdateMs: Math.max(0, totalMs - viewUpdateMs),
      viewUpdateCount,
    })
  }
}

/**
 * 生成并返回一份冻结的性能快照。
 * 同时输出结构化日志。
 */
export function finalizeOpenPerf(): EditorOpenPerfSnapshot {
  const snapshot = getCurrentOpenPerfSnapshot()
  sampleEditorMemory('editor-open-finalize')
  printPerfReport(snapshot)
  return snapshot
}

/**
 * 获取当前首开性能快照。
 *
 * 中文说明：这个方法不打印日志，方便在 DevTools 中反复查看，不打扰控制台。
 */
export function getCurrentOpenPerfSnapshot(): EditorOpenPerfSnapshot {
  return {
    timings: Object.freeze({ ..._timings }),
    docInfo: Object.freeze({ ..._docInfo }),
    nodeViewStats: Object.freeze({ ..._nodeViewStats }),
    setContentStats: Object.freeze({ ..._setContentStats }),
    timestamp: Date.now(),
  }
}

// ==================== 日志输出 ====================

const LOG_TAG = '[EditorOpenPerf]'

function formatMs(ms: number | null): string {
  if (ms === null) return '-'
  return `${ms}ms`
}

function printPerfReport(snapshot: EditorOpenPerfSnapshot): void {
  const { timings, docInfo, nodeViewStats, setContentStats } = snapshot

  console.group(`${LOG_TAG} 文档首开性能报告`)

  console.log(`文档信息: ${docInfo.rootBlockCount} 块, pending=${docInfo.pendingRevisionCount}`)
  console.log(
    `NodeView 创建数: ${nodeViewStats.rootBlockNodeViewCount}`,
    `(` +
      `vue=${nodeViewStats.rootBlockVueNodeViewCount}, ` +
      `dom=${nodeViewStats.rootBlockDomNodeViewCount}, ` +
      `shell=${nodeViewStats.rootBlockShellNodeViewCount}, ` +
      `placeholder=${nodeViewStats.rootBlockPlaceholderNodeViewCount}` +
      `)`
  )
  console.log(
    `NodeView 创建耗时:`,
    `vue=${formatMs(Math.round(nodeViewStats.rootBlockVueNodeViewCreateMs))}`,
    `dom=${formatMs(Math.round(nodeViewStats.rootBlockDomNodeViewCreateMs))}`,
    `shell=${formatMs(Math.round(nodeViewStats.rootBlockShellNodeViewCreateMs))}`,
    `placeholder=${formatMs(Math.round(nodeViewStats.rootBlockPlaceholderNodeViewCreateMs))}`
  )

  console.log(
    `耗时拆分:`,
    `readDocument=${formatMs(timings.readDocumentMs)}`,
    `markdownNormalize=${formatMs(timings.markdownNormalizeMs)}`,
    `method=${setContentStats.method}`,
    `setContent=${formatMs(timings.setContentMs)}`,
    `setContent.nodeFromJSON=${formatMs(timings.setContentNodeFromJsonMs)}`,
    `setContent.stateCreate=${formatMs(timings.setContentStateCreateMs)}`,
    `setContent.updateState=${formatMs(timings.setContentViewUpdateMs)}`,
    `setContent.other=${formatMs(timings.setContentNonViewUpdateMs)}`,
    `updateStateCalls=${setContentStats.viewUpdateCount}`,
    `directState.pluginsStable=${setContentStats.directStatePluginsStabilized ?? '-'}`,
    `directState.detachedDom=${setContentStats.directStateDomDetached ?? '-'}`,
    `directState.detach=${formatMs(
      setContentStats.directStateDomDetachMs === null
        ? null
        : Math.round(setContentStats.directStateDomDetachMs)
    )}`,
    `directState.reattach=${formatMs(
      setContentStats.directStateDomReattachMs === null
        ? null
        : Math.round(setContentStats.directStateDomReattachMs)
    )}`,
    `pendingInject=${formatMs(timings.pendingRevisionInjectMs)}`,
    `totalLoad=${formatMs(timings.totalLoadMs)}`,
    `editorReady=${formatMs(timings.editorReadyMs)}`,
  )

  console.groupEnd()
}

// ==================== DevTools 便利入口 ====================

/**
 * 挂到 window 上，供 editorPerfBenchmark 等工具模块调用。
 * 也方便在 DevTools console 中手动查看/重置性能数据。
 *
 * 示例：
 *   window.__EDITOR_OPEN_PERF__.reset()
 *   window.__EDITOR_OPEN_PERF__.finalize()
 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__EDITOR_OPEN_PERF__ = {
    reset: resetOpenPerf,
    mark: markPerf,
    measure: measurePerf,
    setDocInfo,
    measureSetContentOperation,
    recordSetContentMetrics,
    getCurrent: getCurrentOpenPerfSnapshot,
    finalize: finalizeOpenPerf,
  }
}
