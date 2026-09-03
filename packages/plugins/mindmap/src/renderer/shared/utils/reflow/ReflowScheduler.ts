import type { MindMapInstance } from '../../../domain/types'
import { flickerLog } from '../debug/flickerDebug'

/**
 * 重算原因枚举
 *
 * 中文说明：
 * - 每个 reason 对应一个明确的"尺寸变化来源"
 * - 用于可观测性（日志追踪）与调试
 * - 新增 reason 需要在设计文档中说明触发场景
 */
export type ReflowReason =
  | 'core:init'                  // 内核首屏结构重建（强时序）
  | 'core:refresh'               // 内核结构刷新（强时序）
  | 'nodes:resize'               // nodes 容器尺寸变化（字体/CSS/布局就绪等导致的几何变更）
  | 'node-edit:finish'           // 文本编辑提交导致尺寸变化
  | 'rich-content:mount'         // 富内容首次挂载完成
  | 'rich-content:resize'        // ResizeObserver 检测到富内容尺寸变化
  | 'addons:toggle'              // 节点 addons 展开/收起
  | 'addons:content'             // addons 内部内容变化（如证据列表加载后渲染）
  | 'node-expansion:toggle'      // 节点折叠/展开导致整体几何变化
  | 'node-operation:dom-changed' // 节点操作引起的 DOM 尺寸变化
  | 'debug:manual'               // 手动调试触发

/**
 * ReflowScheduler 接口
 *
 * 中文说明：
 * - request：请求一次重算（会合并同帧请求）
 * - flush：立即执行（极少数场景使用）
 * - dispose：卸载时释放资源
 */
export interface ReflowScheduler {
  /** 请求重算（合并同帧请求） */
  request(reason: ReflowReason): void
  /**
   * 强时序：立即重算（白名单点位专用）
   *
   * 中文说明：
   * - 用于 init/refresh/nodeExpansion 等“必须同步拿到最新几何”的流程
   * - 仍然必须发出 `lifecycle:geometryFlushed`，保证可观测性一致
   */
  forceFlush(reason: ReflowReason): void
  /** 立即执行（谨慎使用，仅测试/调试/内核流程） */
  flush(): void
  /** 卸载释放资源 */
  dispose(): void
  /**
   * Phase 3：添加待关联的事务 ID
   *
   * 中文说明：
   * - 由命令层桥接调用（wrap requestReflow 时注入）
   * - pendingTxIds 与 pendingReasons 同生命周期
   */
  addPendingTxId(txId: string): void
  /**
   * Phase 3：获取当前待关联的事务 ID 集合
   *
   * 中文说明：
   * - 用于诊断与调试
   */
  getPendingTxIds(): string[]
}

/**
 * ReflowScheduler 配置选项
 */
export interface ReflowSchedulerOptions {
  /** 是否启用调试日志（默认 false） */
  debug?: boolean
  /** 是否禁用 scheduler（fallback 到直接调用，用于紧急回退） */
  disabled?: boolean
}

/**
 * 日志条目结构（用于类型安全的日志输出）
 */
interface FlushLogEntry {
  reasons: ReflowReason[]
  coalescedCount: number
  durationMs: number
}

/**
 * 安装重算调度器
 *
 * 核心目标：
 * 1. 收敛所有"尺寸变化 -> linkDiv"的调用
 * 2. 使用 requestAnimationFrame 合并同一帧内的多次重算
 * 3. 提供可观测的日志（知道是谁触发了重算）
 *
 * 中文说明：
 * - 这是 MindMap 的核心基础设施，所有 UI/feature 都应通过 mind.requestReflow() 触发重算
 * - 禁止 UI/feature 直接调用 mind.layout()（会破坏选中状态/Teleport）
 *
 * @param mind MindMap 实例
 * @param options 配置选项
 * @returns ReflowScheduler 实例
 */
export function installMindMapReflowScheduler(
  mind: MindMapInstance,
  options: ReflowSchedulerOptions = {}
): ReflowScheduler {
  // 中文说明：
  // - 默认关闭日志，避免在正常使用时刷屏
  // - 需要排查重排/抖动问题时，再显式传入 { debug: true }
  const { debug = false, disabled = false } = options

  // 内部状态
  let rafId: number | null = null
  let pendingReasons = new Set<ReflowReason>()
  let coalescedCount = 0
  // Phase 3：事务 ID 集合（与 pendingReasons 同生命周期）
  let pendingTxIds = new Set<string>()
  /**
   * 抑制 nodes:resize 的时间窗口（毫秒级）
   *
   * 中文说明（根因修复：杜绝“Enter 新建兄弟节点闪一下”）：
   * - 引擎层安装了 ResizeObserver：nodes 尺寸变化就会 requestReflow('nodes:resize')；
   * - 但“新增节点/插入兄弟”等操作本身已经在 operations 内强时序 `requestReflowNow('node-operation:dom-changed')` 了；
   * - ResizeObserver 会在布局稳定后（通常是随后几毫秒）再触发一次 nodes:resize，导致额外 linkDiv 重绘；
   * - linkDiv 内部会先 `lines.innerHTML=''` 再重建 path，极易产生可感知的“闪一下”；
   * - nodes:resize 的本意是捕获“字体/CSS晚到”等外部变化，因此这里仅在“刚发生过节点操作强时序 flush”后短时间抑制它，
   *   避免自触发重绘，同时不影响真正的外部 resize（通常更晚发生）。
   */
  let suppressNodesResizeUntil = 0

  /**
   * 类型安全的日志函数
   */
  function logFlush(entry: FlushLogEntry): void {
    if (!debug) return
    console.log(
      `[ReflowScheduler] Flush | Reasons: [${entry.reasons.join(', ')}] | Coalesced: ${entry.coalescedCount} | Duration: ${entry.durationMs.toFixed(2)}ms`
    )
  }

  function logRequest(reason: ReflowReason, isFirstInFrame: boolean): void {
    if (!debug) return
    if (isFirstInFrame) {
      console.log(`[ReflowScheduler] Request (new frame): ${reason}`)
    }
    // 非首次请求不打印，避免日志过多
  }

  /**
   * 执行实际的重算
   *
   * 中文说明：
   * - 只调用 linkDiv（几何计算），绝不调用 layout（DOM 重建）
   * - layout 会破坏选中状态、Teleport 目标，属于"红线"
   */
  function flush(): void {
    // 提前清空 rafId，允许 flush 过程中产生的新请求进入下一帧
    rafId = null

    if (pendingReasons.size === 0) {
      return
    }

    const start = performance.now()
    const reasons = Array.from(pendingReasons)
    const currentCoalescedCount = coalescedCount
    // Phase 3：获取并清空 txIds
    const txIds = Array.from(pendingTxIds)

    // 先清空状态，再执行 linkDiv（避免 linkDiv 中触发新请求时状态混乱）
    pendingReasons = new Set<ReflowReason>()
    coalescedCount = 0
    pendingTxIds = new Set<string>()

    flickerLog('reflow flush', {
      t: performance.now(),
      reasons,
      coalescedCount: currentCoalescedCount,
      structureRevision: mind.structureRevision ?? 0,
      txIds,
    })

    // 执行实际的重算
    mind.linkDiv()

    const duration = performance.now() - start

    // Phase 3：构建 geometryFlushed payload，根据 txIds 数量填充不同字段
    interface GeometryFlushedPayload {
      reasons: ReflowReason[]
      coalescedCount: number
      durationMs: number
      structureRevision: number
      timestamp: number
      txId?: string
      txIds?: string[]
    }

    const payload: GeometryFlushedPayload = {
      reasons,
      coalescedCount: currentCoalescedCount,
      durationMs: duration,
      structureRevision: mind.structureRevision ?? 0,
      timestamp: Date.now(),
    }

    // 根据 txIds 数量填充对应字段
    if (txIds.length === 1) {
      payload.txId = txIds[0]
    } else if (txIds.length > 1) {
      payload.txIds = txIds
      // 开发态警告：同一 flush 合并了多个 tx
      if (debug && import.meta.env.MODE !== 'production') {
        console.warn(
          `[ReflowScheduler] Single flush coalesced multiple txs: [${txIds.join(', ')}]`
        )
      }
    }

    // 生命周期信号：几何 flush 完成（观测/诊断用途）
    mind.bus.fire('lifecycle:geometryFlushed', payload)

    logFlush({
      reasons,
      coalescedCount: currentCoalescedCount,
      durationMs: duration,
    })
  }

  /**
   * 请求重算
   *
   * 中文说明：
   * - 使用 rAF 合并同一帧内的多次请求
   * - 记录 reason 用于日志追踪
   */
  function request(reason: ReflowReason): void {
    // 抑制窗口：避免 nodes:resize 紧跟在节点操作后重复触发
    if (reason === 'nodes:resize') {
      const now = performance.now()
      // 中文说明：
      // - 这里无条件输出一次 debug（受 flickerDebug 总开关控制），用于确认抑制窗口是否真的生效；
      // - 之前用户反馈“仍然会闪”，日志显示 nodes:resize 在 node-operation flush 后仍然触发，
      //   需要靠这条日志判断是“窗口没被设置”还是“时间比较不成立”。
      flickerLog('reflow request(nodes:resize) received', {
        t: now,
        suppressUntil: suppressNodesResizeUntil,
        willSuppress: now < suppressNodesResizeUntil,
        structureRevision: mind.structureRevision ?? 0,
      })
      if (now < suppressNodesResizeUntil) {
        flickerLog('reflow request(nodes:resize) suppressed', {
          t: now,
          suppressUntil: suppressNodesResizeUntil,
          structureRevision: mind.structureRevision ?? 0,
        })
        return
      }
    }

    // 如果 scheduler 被禁用，直接调用 linkDiv（用于紧急回退）
    if (disabled) {
      const start = performance.now()
      mind.linkDiv()
      const duration = performance.now() - start
      // 中文说明：即使 disabled 也必须保留 geometryFlushed 观测信号，避免诊断链路断裂
      mind.bus.fire('lifecycle:geometryFlushed', {
        reasons: [reason],
        coalescedCount: 1,
        durationMs: duration,
        structureRevision: mind.structureRevision ?? 0,
        timestamp: Date.now(),
      })
      return
    }

    const isFirstInFrame = rafId === null

    pendingReasons.add(reason)
    coalescedCount++

    logRequest(reason, isFirstInFrame)

    if (isFirstInFrame) {
      rafId = requestAnimationFrame(flush)
    }
  }

  /**
   * 强时序立即重算（白名单点位专用）
   */
  function forceFlush(reason: ReflowReason): void {
    // 中文说明：若当前帧已经排队了 flush，则先取消，避免后续无意义的空 flush 回调
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }

    // 节点操作属于“我们已显式重算”的场景：尽早设置抑制窗口，避免后续 nodes:resize 冗余触发
    if (reason === 'node-operation:dom-changed') {
      suppressNodesResizeUntil = performance.now() + 500
      flickerLog('reflow suppressNodesResizeUntil set (before flush)', {
        t: performance.now(),
        suppressUntil: suppressNodesResizeUntil,
        structureRevision: mind.structureRevision ?? 0,
      })
    }

    pendingReasons.add(reason)
    coalescedCount++
    flush()

    // 节点操作属于“我们已显式重算”的场景：抑制紧随其后的 nodes:resize
    if (reason === 'node-operation:dom-changed') {
      suppressNodesResizeUntil = performance.now() + 500
      flickerLog('reflow suppressNodesResizeUntil set (after flush)', {
        t: performance.now(),
        suppressUntil: suppressNodesResizeUntil,
        structureRevision: mind.structureRevision ?? 0,
      })
    }
  }

  /**
   * 卸载释放资源
   */
  function dispose(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    pendingReasons.clear()
    coalescedCount = 0
    pendingTxIds.clear()
  }

  /**
   * Phase 3：添加待关联的事务 ID
   */
  function addPendingTxId(txId: string): void {
    pendingTxIds.add(txId)
  }

  /**
   * Phase 3：获取当前待关联的事务 ID 集合
   */
  function getPendingTxIds(): string[] {
    return Array.from(pendingTxIds)
  }

  return {
    request,
    forceFlush,
    flush,
    dispose,
    addPendingTxId,
    getPendingTxIds,
  }
}
