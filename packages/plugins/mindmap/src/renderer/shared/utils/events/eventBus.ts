import type { Arrow } from '../../../presentation/render/arrow'
import type { Summary } from '../../../presentation/render/summary'
import type { NodeObj, RichContentDescriptor } from '../../../domain/types/index'
import type { ReflowReason } from '../reflow/ReflowScheduler'

/**
 * 节点操作类型定义
 * 包含移动、复制、添加子节点、插入等单一节点的操作
 */
type NodeOperation =
  | {
      name: 'moveNodeIn' | 'moveDownNode' | 'moveUpNode' | 'copyNode' | 'addChild' | 'insertParent' | 'insertBefore' | 'beginEdit'
      obj: NodeObj
    }
  | {
      /**
       * 节点展开/折叠
       *
       * 中文说明：
       * - 这是“用户可感知”的结构状态变更（会影响视图与导出），应进入 operation 链路：
       *   - 触发 dirty（保存/ai-invoke 前自动保存）
       *   - 进入 history（undo/redo 快照）
       * - expanded 口径：与渲染一致，`nodeObj.expanded !== false` 视为展开
       */
      name: 'toggleExpand'
      obj: NodeObj
      originExpanded: boolean
      expanded: boolean
    }
  | {
      name: 'insertSibling'
      type: 'before' | 'after'
      obj: NodeObj
    }
  | {
      name: 'reshapeNode'
      obj: NodeObj
      origin: NodeObj
    }
  | {
      name: 'finishEdit'
      obj: NodeObj
      origin: string
    }
  | {
      name: 'moveNodeAfter' | 'moveNodeBefore' | 'moveNodeIn'
      objs: NodeObj[]
      toObj: NodeObj
    }

/**
 * 多节点操作类型定义
 * 包含批量移除、批量复制等操作
 */
type MultipleNodeOperation =
  | {
      name: 'removeNodes'
      objs: NodeObj[]
    }
  | {
      name: 'copyNodes'
      objs: NodeObj[]
    }

/**
 * 概要（Summary）操作类型定义
 * 包含创建、移除、完成编辑概要
 */
export type SummaryOperation =
  | {
      name: 'createSummary'
      obj: Summary
    }
  | {
      name: 'removeSummary'
      obj: { id: string }
    }
  | {
      name: 'finishEditSummary'
      obj: Summary
    }

/**
 * 关联线（Arrow）操作类型定义
 * 包含创建、移除、编辑关联线标签
 */
export type ArrowOperation =
  | {
      name: 'createArrow'
      obj: Arrow
    }
  | {
      name: 'removeArrow'
      obj: { id: string }
    }
  | {
      name: 'finishEditArrowLabel'
      obj: Arrow
    }

/**
 * 操作元信息（命令关联）
 *
 * 中文说明：
 * - 当 operation 由命令层触发时，runner 会自动注入这些字段
 * - 用于可观测性追踪：txId -> operation -> history
 */
export type OperationMeta = {
  /** 事务 ID（命令执行时生成） */
  txId?: string
  /** 触发此操作的命令名称 */
  commandName?: string
  /** 命令来源 */
  source?: 'hotkey' | 'contextMenu' | 'toolbar' | 'mouse' | 'feature' | 'script' | 'unknown'
  /** 操作时的结构版本号 */
  structureRevision?: number
  /** 外部追踪 ID（跨系统） */
  traceId?: string
  /** 操作时间戳 */
  timestamp?: number
}

/**
 * 带可选 meta 的操作基类
 */
type WithMeta<T> = T & { meta?: OperationMeta }

/**
 * 统一操作类型联合类型
 *
 * 中文说明：
 * - 所有 operation 现在都可以携带可选的 meta 字段
 * - meta 由命令层在 fire 时自动注入，operation 层无需关心
 */
export type Operation = WithMeta<NodeOperation | MultipleNodeOperation | SummaryOperation | ArrowOperation>

/**
 * 操作名称类型提取
 */
export type OperationType = Operation['name']

/**
 * operation payload 运行时守卫
 *
 * 中文说明：
 * - TS 类型只能保证“写 TS 的调用点”正确；但 eventBus 允许任何 JS/动态数据进入
 * - 这里提供一个轻量、可解释的 runtime 校验，避免非法 payload 混入后造成隐性 bug
 * - 校验失败：开发态输出结构化错误 + stack，并跳过触发（fail fast but not crash）
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStringId(value: unknown): value is { id: string } {
  return isPlainObject(value) && typeof value.id === 'string' && value.id.length > 0
}

function isNodeArray(value: unknown): value is NodeObj[] {
  if (!Array.isArray(value)) return false
  for (const item of value) {
    if (!hasStringId(item)) return false
  }
  return true
}

export function isOperationPayload(value: unknown): value is Operation {
  if (!isPlainObject(value)) return false
  const name = value.name
  if (typeof name !== 'string') return false

  switch (name as OperationType) {
    // Summary
    case 'createSummary':
    case 'finishEditSummary':
      return hasStringId((value as { obj?: unknown }).obj)
    case 'removeSummary':
      return hasStringId((value as { obj?: unknown }).obj)

    // Arrow
    case 'createArrow':
    case 'finishEditArrowLabel':
      return hasStringId((value as { obj?: unknown }).obj)
    case 'removeArrow':
      return hasStringId((value as { obj?: unknown }).obj)

    // Multiple node
    case 'removeNodes':
    case 'copyNodes':
      return isNodeArray((value as { objs?: unknown }).objs)

    // Move family (注意：moveNodeIn 有两种形态：obj / objs)
    case 'moveNodeBefore':
    case 'moveNodeAfter': {
      const objs = (value as { objs?: unknown }).objs
      const toObj = (value as { toObj?: unknown }).toObj
      return isNodeArray(objs) && hasStringId(toObj)
    }
    case 'moveNodeIn': {
      const maybeObjs = (value as { objs?: unknown }).objs
      if (maybeObjs !== undefined) {
        const toObj = (value as { toObj?: unknown }).toObj
        return isNodeArray(maybeObjs) && hasStringId(toObj)
      }
      return hasStringId((value as { obj?: unknown }).obj)
    }

    // Node single
    case 'insertSibling': {
      const t = (value as { type?: unknown }).type
      if (t !== 'before' && t !== 'after') return false
      return hasStringId((value as { obj?: unknown }).obj)
    }
    case 'reshapeNode':
      return hasStringId((value as { obj?: unknown }).obj) && hasStringId((value as { origin?: unknown }).origin)
    case 'finishEdit':
      return hasStringId((value as { obj?: unknown }).obj) && typeof (value as { origin?: unknown }).origin === 'string'
    case 'addChild':
    case 'copyNode':
    case 'moveUpNode':
    case 'moveDownNode':
    case 'insertParent':
    case 'insertBefore':
    case 'beginEdit':
    case 'toggleExpand':
      return hasStringId((value as { obj?: unknown }).obj)
    default:
      return false
  }
}

/**
 * 生命周期：文档上下文就绪
 *
 * 中文说明：
 * - 仅代表“当前 MindMap 已绑定到某个 documentId”
 * - 不代表 nodeData/DOM 已完成结构重建
 */
export type LifecycleDocumentReadyPayload = {
  documentId: string
  reason: 'open' | 'reload' | 'switch'
  timestamp: number
}

/**
 * 生命周期：结构就绪（nodeData 已 apply，DOM 已重建）
 *
 * 中文说明：
 * - 这是 feature 初始化（按节点扫描、counts 初始化、addons 挂载）的关键稳定信号
 * - `structureRevision` 用于诊断“结构变化 vs 几何重算是否匹配”
 */
export type LifecycleStructureReadyPayload = {
  documentId: string
  nodeCount: number
  structureRevision: number
  timestamp: number
}

/**
 * 生命周期：几何已重算（linkDiv flush 完成）
 *
 * 中文说明：
 * - 这是观测/诊断信号，业务不应依赖它做初始化控制
 * - Phase 3 扩展：txId/txIds 用于关联事务记录
 */
export type LifecycleGeometryFlushedPayload = {
  reasons: ReflowReason[]
  coalescedCount: number
  durationMs: number
  structureRevision: number
  timestamp: number
  /**
   * 关联的事务 ID（单个 tx 触发时）
   *
   * 中文说明：
   * - 当 pendingTxIds.size === 1 时填充
   * - 用于 TxRecorder 聚合 reflow 到对应 tx
   */
  txId?: string
  /**
   * 关联的事务 ID 集合（多个 tx 触发时）
   *
   * 中文说明：
   * - 当 pendingTxIds.size > 1 时填充
   * - 同一 flush 可被多个 tx 共享
   */
  txIds?: string[]
}

/**
 * 事件映射表
 * 定义了系统中所有可用的事件及其处理函数的签名
 */
export type EventMap = {
  /** 生命周期：文档上下文就绪 */
  'lifecycle:documentReady': (payload: LifecycleDocumentReadyPayload) => void
  /** 生命周期：结构就绪（DOM 重建完成） */
  'lifecycle:structureReady': (payload: LifecycleStructureReadyPayload) => void
  /** 生命周期：几何已重算（linkDiv flush 完成） */
  'lifecycle:geometryFlushed': (payload: LifecycleGeometryFlushedPayload) => void

  // -----------------------------
  // Feature 信号（feature:*）
  // -----------------------------
  /** 执行操作事件 */
  operation: (info: Operation) => void

  // -----------------------------
  // UI 意图事件（ui:*）
  // -----------------------------
  /**
   * UI：请求打开右键菜单（纯 payload 版本）
   *
   * 中文说明：
   * - 这是“可审计”的 UI 意图事件：只携带业务 nodeId 与屏幕坐标
   * - 禁止携带 MouseEvent/HTMLElement（见 docs/MINDMAP_DEV_GUIDE.md）
   */
  'ui:openContextMenu': (payload: { nodeId?: string; x: number; y: number; trigger: 'mouse' | 'keyboard' }) => void
  /**
   * UI：开始节点编辑（纯 payload 版本）
   *
   * 中文说明：
   * - NodeEditor 只需要业务 nodeId；DOM 元素在组件内通过 mind.findEle(nodeId) 获取
   * - 禁止跨层传递 HTMLElement（见 docs/MINDMAP_DEV_GUIDE.md）
   */
  'ui:startNodeEdit': (payload: { nodeId: string; trigger: 'mouse' | 'keyboard' }) => void

  // -----------------------------
  // 状态广播事件（state:*）
  // -----------------------------
  /** 状态：选择多个节点（推荐新事件名） */
  'state:selectNodes': (nodeObj: NodeObj[]) => void
  /** 状态：取消选择节点（推荐新事件名） */
  'state:unselectNodes': (nodeObj: NodeObj[]) => void
  /** 状态：节点展开/折叠（推荐新事件名） */
  'state:nodeExpanded': (nodeObj: NodeObj) => void
  /** 状态：方向改变（推荐新事件名） */
  'state:directionChanged': (direction: number) => void
  /** 状态：缩放变化（推荐新事件名） */
  'state:scaleChanged': (scale: number) => void
  /** 状态：视图移动（推荐新事件名） */
  'state:viewMoved': (data: { dx: number; dy: number }) => void
  /**
   * 状态：选区变化（Phase 2 新增）
   *
   * 中文说明：
   * - 仅包含业务 nodeId，禁止 DOM 泄漏
   * - traceId 用于关联 intent -> command -> operation
   */
  'state:selectionChanged': (data: {
    addedNodeIds: string[]
    removedNodeIds: string[]
    traceId: string
    source: 'keyboard' | 'click' | 'dblclick' | 'wheel' | 'contextmenu' | 'drag' | 'selection' | 'api' | 'unknown'
  }) => void

  /** 选择新节点 */
  selectNewNode: (nodeObj: NodeObj) => void
  /**
   * 链接 DIV 元素
   * @deprecated
   *
   * 中文说明：
   * - `linkDiv` 属于渲染实现细节（几何重算被调用了），不应作为 readiness 信号
   * - 业务/feature 请监听：`lifecycle:structureReady` / `lifecycle:documentReady` / `lifecycle:geometryFlushed`
   */
  linkDiv: () => void
  /**
   * 更新关联线变化
   * 注意：请使用节流（throttling）以防止性能下降
   */
  updateArrowDelta: (arrow: Arrow) => void
  /** 挂载富文本内容 */
  richContentMount: (payload: { node: NodeObj; host: HTMLElement; descriptor: RichContentDescriptor }) => void
  /** 卸载富文本内容 */
  richContentUnmount: (payload: { nodeId: string }) => void
}

/**
 * 创建事件总线
 * 提供简单的发布-订阅模式实现
 */
export function createBus() {
  type BusEventMap = EventMap

  type DebugListenerMeta = {
    type: keyof BusEventMap
    registeredAt: number
    stack?: string
  }

  type DebugState = {
    captureListenerStack: boolean
    tracedFireTypes: Set<keyof BusEventMap>
    listenerMeta: WeakMap<Function, DebugListenerMeta>
    interactionGateEnabled: boolean
  }

  const isDev = import.meta.env.MODE !== 'production'

  const debugState: DebugState = {
    captureListenerStack: false,
    tracedFireTypes: new Set<keyof BusEventMap>(),
    listenerMeta: new WeakMap<Function, DebugListenerMeta>(),
    interactionGateEnabled: false,
  }

  function captureStack(): string | undefined {
    if (!isDev) return undefined
    try {
      const err = new Error()
      return err.stack
    } catch {
      return undefined
    }
  }

  function callHandler<K extends keyof BusEventMap>(
    handler: BusEventMap[K],
    payload: Parameters<BusEventMap[K]>
  ): void {
    // 中文说明：EventMap 目前只允许 0 或 1 个参数（推荐都用对象 payload）
    if (payload.length === 0) {
      ;(handler as unknown as () => void)()
      return
    }
    ;(handler as unknown as (arg0: Parameters<BusEventMap[K]>[0]) => void)(payload[0])
  }

  /**
   * handlers 存储结构
   *
   * 中文说明：
   * - 这里用 “key -> handler union array” 的形式存储，避免 TS 在 `handlers[type] = [handler]`
   *   这类写法上产生复杂的索引推断错误。
   * - 对外 API 仍然保持严格的泛型签名（addListener/fire/removeListener）。
   */
  const handlers: Partial<Record<keyof BusEventMap, Array<BusEventMap[keyof BusEventMap]>>> = {}

  return {
    handlers,
    /**
     * 开发态调试工具（生产环境下保持为 no-op 或弱输出）
     *
     * 中文说明：
     * - 这些工具用于解决“谁在监听/谁在触发导致副作用”问题
     * - 默认不开启 capture stack（避免性能开销与日志噪声），需要时手动开启
     */
    debug: {
      /**
       * 开启/关闭 listener 注册栈采集
       */
      setCaptureListenerStack(enabled: boolean) {
        if (!isDev) return
        debugState.captureListenerStack = enabled
      },
      /**
       * 输出当前 listener 分布（按事件）
       *
       * @returns 摘要对象，便于测试/脚本消费
       */
      dumpListeners() {
        const summary: Record<string, { count: number; sampleStacks: string[] }> = {}
        const types = Object.keys(handlers) as Array<keyof BusEventMap>
        for (const type of types) {
          const list = handlers[type]
          if (!Array.isArray(list) || list.length === 0) continue
          const stacks: string[] = []
          if (isDev) {
            for (const fn of list) {
              const meta = debugState.listenerMeta.get(fn as unknown as Function)
              if (meta?.stack) stacks.push(meta.stack)
            }
          }
          summary[String(type)] = {
            count: list.length,
            sampleStacks: stacks.slice(0, 3),
          }
        }
        if (isDev) {
          console.log('[MindMapBus] dumpListeners', summary)
        }
        return summary
      },
      /**
       * 对指定事件开启 fire stack 追踪（返回关闭函数）
       */
      traceFire(type: keyof BusEventMap) {
        if (!isDev) return () => {}
        debugState.tracedFireTypes.add(type)
        return () => {
          debugState.tracedFireTypes.delete(type)
        }
      },

      /**
       * InteractionGate 调试开关（仅开发态生效）
       *
       * 中文说明：
       * - Gate API 本身支持 { debug: true } 输出“为什么被忽略”
       * - 这里提供一个全局开关，便于一次性开启/关闭所有入口的 Gate debug
       */
      interactionGate: {
        setEnabled(enabled: boolean) {
          if (!isDev) return
          debugState.interactionGateEnabled = enabled
          console.log('[MindMapBus] interactionGate.setEnabled', enabled)
        },
        isEnabled() {
          return isDev && debugState.interactionGateEnabled
        },
      },
    },

    /**
     * 添加事件监听器
     * @param type 事件类型
     * @param handler 处理函数
     */
    addListener: function <K extends keyof BusEventMap>(type: K, handler: BusEventMap[K]) {
      const list = handlers[type]
      if (list === undefined) {
        handlers[type] = [handler]
        if (isDev && debugState.captureListenerStack) {
          debugState.listenerMeta.set(handler as unknown as Function, {
            type,
            registeredAt: Date.now(),
            stack: captureStack(),
          })
        }
        return
      }
      list.push(handler)
      if (isDev && debugState.captureListenerStack) {
        debugState.listenerMeta.set(handler as unknown as Function, {
          type,
          registeredAt: Date.now(),
          stack: captureStack(),
        })
      }
    },

    /**
     * 触发事件
     * @param type 事件类型
     * @param payload 传递给处理函数的参数
     */
    fire: function <K extends keyof BusEventMap>(type: K, ...payload: Parameters<BusEventMap[K]>) {
      // fire trace（开发态）
      if (isDev && debugState.tracedFireTypes.has(type)) {
        console.log('[MindMapBus] traceFire', {
          type,
          payloadPreview: payload.length > 0 ? payload[0] : undefined,
          stack: captureStack(),
        })
      }

      // operation payload 守卫（开发态/生产态一致生效：避免非法 payload 污染历史/插件）
      if (type === 'operation') {
        const op = payload.length > 0 ? (payload[0] as unknown) : undefined
        if (!isOperationPayload(op)) {
          console.error('[MindMapBus] invalid operation payload (dropped)', {
            payload: op,
            stack: isDev ? captureStack() : undefined,
          })
          return
        }
      }

      // 先触发原事件
      const list = handlers[type]
      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const handler = list[i] as BusEventMap[K]
          callHandler(handler, payload)
        }
      }
    },

    /**
     * 移除事件监听器
     * @param type 事件类型
     * @param handler 要移除的处理函数
     */
    removeListener: function <K extends keyof BusEventMap>(type: K, handler: BusEventMap[K]) {
      const list = handlers[type]
      if (!list) return
      if (!handler) {
        list.length = 0
        return
      }
      for (let i = 0; i < list.length; i++) {
        if (list[i] === handler) {
          list.splice(i, 1)
          i--
        }
      }
    },
  }
}
