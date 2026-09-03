/**
 * @file 自动刷新核心编排器
 *
 * 中文说明：
 * - 接收刷新请求，合并/防抖
 * - 检查交互门禁，决定立即刷新或延迟
 * - 执行刷新（复用 mindmapHandler.open）
 * - 恢复 viewport/selection 快照
 * - 输出可观测日志
 *
 * 设计原则：
 * - 单例模式：整个应用只有一个编排器实例
 * - 触发方只"发请求"，不直接调用刷新
 * - 统一入口，避免散落调用
 *
 * @see packages/plugins/mindmap/src/renderer/features/autoRefresh/README.md
 */

import { useMindMapStore } from '../../../domain/store/mindmapStore'
import type { MindMapInstance } from '../../../domain/types'
import { getActiveFileSession } from '@plugin/renderer/workspaceRuntime'
import { mindmapHandler } from '../../../file-handler/mindmap'
import { checkRefreshAllowedWithLog, waitForInteractionEnd } from './mindMapRefreshGate'
import { takeRefreshSnapshot, restoreRefreshSnapshot } from './mindMapRefreshSnapshot'
import { watch } from 'vue'
import type {
  RefreshRequest,
  RefreshResult,
  PendingRefresh,
  RefreshReason,
} from '../domain/types'
import { LOG_PREFIX } from '../domain/types'

// =========================================================================
// 配置常量
// =========================================================================

/** 防抖窗口时间（毫秒） */
const DEBOUNCE_WINDOW_MS = 300

/** 结构就绪等待超时（毫秒） */
const STRUCTURE_READY_TIMEOUT_MS = 2000
const READY_TIMEOUT_MS = 2000

/** 调试模式（可通过 window 开关） */
function isDebugEnabled(): boolean {
  const w = window as { __MM_AUTO_REFRESH_DEBUG__?: boolean }
  // 中文说明：
  // - 用户反馈：不希望每次都手动在控制台执行开关命令才能看到日志；
  // - 因此在“未显式设置开关”时，开发环境默认开启 debug 日志；
  // - 仍保留 window 开关的优先级，便于强制开/关（例如排查线上录屏或减少刷屏）。
  if (typeof w.__MM_AUTO_REFRESH_DEBUG__ === 'boolean') {
    return w.__MM_AUTO_REFRESH_DEBUG__
  }
  return import.meta.env.DEV
}

/**
 * 等待下一次 structureReady（替代 setTimeout 猜测）
 *
 * 中文说明（稳定性关键点）：
 * - 之前用固定 50ms 延时，会在不同机器/文档规模下产生不确定性（选区恢复失败、抖动）
 * - 正确做法是等待 `lifecycle:structureReady` 信号（由 init/refresh 在结构重建完成后统一发出）
 */
function waitForNextStructureReady(params: {
  mind: MindMapInstance
  documentId: string
  minStructureRevision: number
  timeoutMs?: number
  debug: boolean
}): Promise<void> {
  const { mind, documentId, minStructureRevision, timeoutMs = STRUCTURE_READY_TIMEOUT_MS, debug } = params

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      mind.bus.removeListener('lifecycle:structureReady', handler)
      reject(new Error(`waitForNextStructureReady timeout (${timeoutMs}ms)`))
    }, timeoutMs)

    const handler = (payload: {
      documentId: string
      structureRevision: number
      timestamp: number
    }) => {
      if (payload.documentId !== documentId) return
      if (payload.structureRevision <= minStructureRevision) return
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      mind.bus.removeListener('lifecycle:structureReady', handler)
      if (debug) {
        console.log(`${LOG_PREFIX} waitForNextStructureReady resolved`, {
          documentId,
          structureRevision: payload.structureRevision,
        })
      }
      resolve()
    }

    mind.bus.addListener('lifecycle:structureReady', handler)
  })
}

/**
 * 等待 MindMap 进入“可见就绪态”（isMindMapReady=true）。
 *
 * 中文说明（根因级）：
 * - structureReady 表示“结构重建完成”，但不等价于“画布 ready”；
 * - mindmapStore.isMindMapReady 会在 requestAnimationFrame 阶段被置为 true，
 *   用于避免在 applyContent 的中间态展示旧内容；
 * - AutoRefresh 若在 ready 前采集 viewport，会因为 anchor 未更新导致后续 geometryFlushed 重基准时出现“视图漂移”。
 */
function waitForMindMapReady(params: {
  mindmapStore: ReturnType<typeof useMindMapStore>
  documentId: string
  timeoutMs?: number
  debug: boolean
}): Promise<void> {
  const { mindmapStore, documentId, timeoutMs = READY_TIMEOUT_MS, debug } = params

  return new Promise((resolve) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      stop()
      if (debug) {
        console.warn(`${LOG_PREFIX} waitForMindMapReady timeout`, { documentId, timeoutMs })
      }
      resolve()
    }, timeoutMs)

    const stop = watch(
      [() => mindmapStore.isMindMapReady, () => mindmapStore.currentDocumentId],
      ([ready, currentDoc]) => {
        if (settled) return
        if (currentDoc !== documentId) return
        if (ready !== true) return
        settled = true
        window.clearTimeout(timer)
        stop()
        if (debug) {
          console.log(`${LOG_PREFIX} waitForMindMapReady resolved`, { documentId })
        }
        resolve()
      },
      { immediate: true }
    )
  })
}

// =========================================================================
// 服务状态（单例）
// =========================================================================

/** 待处理的刷新请求（按 documentId 分组） */
const pendingRefreshMap = new Map<string, PendingRefresh>()

/** 防抖定时器（按 documentId 分组） */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 正在执行的刷新 Promise（避免重入） */
let executingRefreshPromise: Promise<RefreshResult> | null = null

/** 延迟刷新的取消函数 */
let cancelDelayedRefresh: (() => void) | null = null

// =========================================================================
// 核心 API
// =========================================================================

/**
 * 请求刷新（统一入口）
 *
 * 中文说明：
 * - 外部触发刷新的唯一入口
 * - 内部处理合并/防抖/门禁/执行
 * - 返回 Promise<boolean> 表示是否成功触发
 *
 * @param request 刷新请求参数
 */
export async function requestRefresh(request: RefreshRequest): Promise<boolean> {
  const debug = isDebugEnabled()
  const { documentId, reason, sourceTool, versionNumber } = request

  // 1. 检查是否是当前打开的文档（以 file-manager 的 activeSession 为权威）
  //
  // 中文说明（根因级）：
  // - 自动刷新最终会调用 `mindmapHandler.open(session)`，其“目标文档”由 file-manager 的 activeSession 决定；
  // - 因此这里用 `getActiveFileSession()` 作为一等判断依据，避免 mindmapStore 与 session 偶发不同步导致误判；
  // - mindmapStore.currentDocumentId 仍作为兜底（例如 session 暂时为空的极端调试场景）。
  const session = getActiveFileSession()
  const mindmapStore = useMindMapStore()
  const currentDocId =
    session && session.type === 'mindmap'
      ? session.documentId
      : mindmapStore.currentDocumentId

  if (currentDocId !== documentId) {
    // 关键：即使未开启 debug，也要给出“为什么被忽略”的可观测线索，否则用户会以为刷新机制失效
    console.warn(`${LOG_PREFIX} requestRefresh ignored: documentId mismatch`, {
      currentDocumentId: currentDocId,
      requestedDocumentId: documentId,
      sessionType: session?.type,
      reason,
      sourceTool,
      versionNumber,
    })
    return false
  }

  if (debug) {
    console.log(`${LOG_PREFIX} requestRefresh:`, {
      documentId,
      reason,
      sourceTool,
      versionNumber,
    })
  }

  // 2. 合并到 pending 队列
  coalescePendingRefresh(documentId, reason, versionNumber)

  // 3. 设置/重置防抖定时器
  const existingTimer = debounceTimers.get(documentId)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(documentId)
    void triggerRefresh(documentId).catch((error) => {
      // 中文说明：triggerRefresh 内部若出现同步异常，会变成 Promise reject；
      // 这里必须 catch，避免出现 “Uncaught (in promise)” 导致刷新链路静默中断。
      console.error(`${LOG_PREFIX} triggerRefresh failed`, error)
    })
  }, DEBOUNCE_WINDOW_MS)

  debounceTimers.set(documentId, timer)

  return true
}

/**
 * 合并刷新请求到 pending 队列
 */
function coalescePendingRefresh(
  documentId: string,
  reason: RefreshReason,
  versionNumber?: number
): void {
  const debug = isDebugEnabled()
  const now = Date.now()

  const existing = pendingRefreshMap.get(documentId)

  if (existing) {
    // 合并到现有请求
    if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason)
    }
    if (versionNumber !== undefined) {
      existing.latestVersionNumber = Math.max(
        existing.latestVersionNumber ?? 0,
        versionNumber
      )
    }
    existing.lastRequestedAt = now
    existing.coalescedCount++

    if (debug) {
      console.log(`${LOG_PREFIX} coalesced:`, {
        coalescedCount: existing.coalescedCount,
        reasons: existing.reasons,
      })
    }
  } else {
    // 创建新的 pending
    pendingRefreshMap.set(documentId, {
      documentId,
      reasons: [reason],
      latestVersionNumber: versionNumber,
      firstRequestedAt: now,
      lastRequestedAt: now,
      coalescedCount: 1,
    })
  }
}

/**
 * 触发刷新（防抖结束后调用）
 */
async function triggerRefresh(documentId: string): Promise<void> {
  const debug = isDebugEnabled()
  const pending = pendingRefreshMap.get(documentId)

  if (!pending) {
    if (debug) {
      console.log(`${LOG_PREFIX} triggerRefresh: no pending for`, documentId)
    }
    return
  }

  const mindmapStore = useMindMapStore()
  const mind = mindmapStore.mind

  // 检查门禁
  const gateResult = checkRefreshAllowedWithLog(mind, debug)

  if (!gateResult.allowed) {
    // 门禁阻塞，等待交互结束
    if (debug) {
      console.log(
        `${LOG_PREFIX} triggerRefresh: gated, waiting for interaction end`
      )
    }

    // 取消之前的延迟等待
    if (cancelDelayedRefresh) {
      cancelDelayedRefresh()
    }

    // 注册新的延迟等待
    cancelDelayedRefresh = waitForInteractionEnd(
      mind,
      () => {
        cancelDelayedRefresh = null
        void executeRefresh(documentId)
      },
      { debug }
    )

    return
  }

  // 门禁放行，立即执行
  void executeRefresh(documentId)
}

/**
 * 执行刷新（核心逻辑）
 */
async function executeRefresh(documentId: string): Promise<RefreshResult> {
  const debug = isDebugEnabled()
  const pending = pendingRefreshMap.get(documentId)

  // 清除 pending
  pendingRefreshMap.delete(documentId)

  if (!pending) {
    return {
      success: false,
      documentId,
      durationMs: 0,
      error: 'no pending refresh',
      snapshotRestored: false,
    }
  }

  // 防止重入
  if (executingRefreshPromise) {
    if (debug) {
      console.log(`${LOG_PREFIX} executeRefresh: already executing, queuing`)
    }
    // 等待当前执行完成后再执行
    await executingRefreshPromise
  }

  const startTime = performance.now()
  const mindmapStore = useMindMapStore()

  if (debug) {
    console.log(`${LOG_PREFIX} executeRefresh:`, {
      documentId,
      reasons: pending.reasons,
      coalescedCount: pending.coalescedCount,
    })
  }

  // 1. 采集快照
  const snapshot = takeRefreshSnapshot()

  // 2. 执行刷新
  const refreshPromise = (async (): Promise<RefreshResult> => {
    try {
      // 获取当前 session
      const session = getActiveFileSession()
      if (!session || session.type !== 'mindmap' || session.documentId !== documentId) {
        return {
          success: false,
          documentId,
          durationMs: performance.now() - startTime,
          error: 'session mismatch',
          snapshotRestored: false,
        }
      }

      const mindBeforeOpen = mindmapStore.mind
      const prevStructureRevision = mindBeforeOpen?.structureRevision ?? 0
      const waitStructureReadyPromise = mindBeforeOpen
        ? waitForNextStructureReady({
            mind: mindBeforeOpen,
            documentId,
            minStructureRevision: prevStructureRevision,
            debug,
          })
        : null

      // 调用 mindmapHandler.open 重新加载
      await mindmapHandler.open(session)

      // 3. 等待结构重建完成
      // 中文说明：
      // - open() 内部会触发 setDocumentSession -> init/refresh -> fireStructureReady
      // - 必须等待 structureReady，否则 selection 恢复会因 DOM 未挂载而失败
      if (waitStructureReadyPromise) {
        await waitStructureReadyPromise
      }

      // 4. 恢复快照
      const mind = mindmapStore.mind
      let snapshotRestored = false
      let restoreFailReason: string | undefined

      if (mind) {
        const restoreResult = restoreRefreshSnapshot(mind, snapshot, { debug })
        snapshotRestored =
          restoreResult.viewportRestored &&
          restoreResult.selectionRestored &&
          restoreResult.focusModeRestored
        restoreFailReason = restoreResult.failReason

        // 中文说明（与 mindmapStore 的“锚点视口”同步）：
        // - AutoRefresh 的快照恢复会直接写 DOM transform，不一定触发 viewMoved；
        // - 若不立刻同步 store 的 viewport/anchor 缓存，后续 addons/字体触发 geometryFlushed 时会按旧缓存重基准，造成“右偏/漂移”。
        mindmapStore.captureViewportSnapshot()

        // 🔥 根因修复：等待 ready 后再采集一次，确保 anchor 在“可见稳定态”水合
        if (mindmapStore.isMindMapReady !== true) {
          await waitForMindMapReady({ mindmapStore, documentId, debug })
          mindmapStore.captureViewportSnapshot()
        }
      }

      const durationMs = performance.now() - startTime

      if (debug) {
        console.log(`${LOG_PREFIX} executeRefresh: success`, {
          durationMs: Math.round(durationMs),
          snapshotRestored,
        })
      }

      return {
        success: true,
        documentId,
        durationMs,
        snapshotRestored,
        restoreFailReason,
      }
    } catch (error) {
      const durationMs = performance.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      console.error(`${LOG_PREFIX} executeRefresh: failed`, error)

      return {
        success: false,
        documentId,
        durationMs,
        error: errorMessage,
        snapshotRestored: false,
      }
    }
  })()

  executingRefreshPromise = refreshPromise

  try {
    return await refreshPromise
  } finally {
    executingRefreshPromise = null
  }
}

// =========================================================================
// 工具函数
// =========================================================================

/**
 * 取消所有待处理的刷新
 *
 * 中文说明：
 * - 用于文档切换时清理状态
 * - 防止刷新执行到错误的文档
 */
export function cancelAllPendingRefresh(): void {
  const debug = isDebugEnabled()

  if (debug) {
    console.log(`${LOG_PREFIX} cancelAllPendingRefresh:`, {
      pendingCount: pendingRefreshMap.size,
      timerCount: debounceTimers.size,
    })
  }

  // 清除所有定时器
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()

  // 清除所有 pending
  pendingRefreshMap.clear()

  // 取消延迟等待
  if (cancelDelayedRefresh) {
    cancelDelayedRefresh()
    cancelDelayedRefresh = null
  }
}

/**
 * 获取当前待处理的刷新数量（调试用）
 */
export function getPendingRefreshCount(): number {
  return pendingRefreshMap.size
}

/**
 * 开启/关闭调试模式
 */
export function setAutoRefreshDebug(enabled: boolean): void {
  (window as { __MM_AUTO_REFRESH_DEBUG__?: boolean }).__MM_AUTO_REFRESH_DEBUG__ = enabled
  console.log(`${LOG_PREFIX} debug mode:`, enabled ? 'ON' : 'OFF')
}

// 暴露到 window 方便调试
if (typeof window !== 'undefined') {
  (window as { __setAutoRefreshDebug?: typeof setAutoRefreshDebug }).__setAutoRefreshDebug = setAutoRefreshDebug
}
