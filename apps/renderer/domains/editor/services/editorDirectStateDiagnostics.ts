/**
 * editorDirectStateDiagnostics.ts
 *
 * direct-state 文档加载路径的细粒度耗时诊断工具。
 *
 * 背景：
 * - 10000 个 rootBlock 的文档，`view.update({ ...view.props, state })` 实测耗时约 6 秒；
 * - 但 NodeView 工厂只跑了几十毫秒；
 * - 需要进一步把 view.update 的耗时拆到每个 ProseMirror plugin 上，定位真正的瓶颈：
 *     1. plugin.props.decorations(state) —— viewDecorations 阶段调用，可能对全文档 O(N) 遍历；
 *     2. pluginView.update(view, prevState) —— updatePluginViews 阶段调用，可能读 DOM 或重算布局；
 *     3. 其他（docView 重建 / DOM 同步 / selection sync）。
 *
 * 用法：用 `instrumentDirectStateViewUpdate(view, () => view.update(...))` 包裹一次原子切换。
 * 函数会临时 monkey-patch 所有 plugin 的 `props.decorations` 与 view.pluginViews 上的 `update`
 * 方法，跑完 operation 后恢复，并在控制台打印分项耗时。
 *
 * 设计约束：
 * - 不影响生产逻辑：只在 operation 调用期间做包装，try/finally 恢复，崩了也不留后遗症；
 * - 类型严格：不使用 any 断言，私有字段通过 `unknown + type guard` 访问；
 * - 零 IO 副作用：仅 console.log，不写入任何文件或网络。
 */

import type { EditorState, Plugin as ProseMirrorPlugin } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'

// ==================== 类型定义 ====================

/**
 * ProseMirror EditorView 上诊断需要用到的最小接口。
 *
 * 中文说明：直接 import EditorView 会引入完整类型，但 `pluginViews` / `state.plugins`
 * 等字段足以诊断。这里只声明用到的部分，且通过 unknown 兼容运行时差异。
 */
export interface EditorViewLike {
  state?: EditorState
  pluginViews?: PluginViewHandleLike[]
  docView?: DocViewLike
  dom?: DomNodeLike
}

interface PluginViewHandleLike {
  update?: (view: EditorViewLike, prevState: EditorState) => void
}

/**
 * 极简的 NodeViewDesc 接口（仅用于诊断包装）。
 * ProseMirror 没有把 docView 的类型 export 出来，这里只声明诊断需要用到的字段。
 */
interface DocViewLike {
  update?: (...args: unknown[]) => unknown
  destroy?: (...args: unknown[]) => unknown
}

/** 极简的 DOM Node 接口（用于统计 appendChild / insertBefore / removeChild 调用次数） */
interface DomNodeLike {
  appendChild?: (node: Node) => Node
  insertBefore?: (node: Node, child: Node | null) => Node
  removeChild?: (child: Node) => Node
}

/** ProseMirror NodeType 的最小接口（用于读取并临时包装 spec.toDOM） */
interface NodeTypeLike {
  spec?: { toDOM?: unknown }
}

/** plugin 的 decorations prop 是 viewDecorations 调用入口 */
type DecorationsFn = (state: EditorState) => DecorationSet | null | undefined

interface DiagnosticEntry {
  /** plugin.key（含 `$` 后缀） */
  pluginKey: string
  /** decorations(state) 累计耗时（毫秒） */
  decorationsMs: number
  /** decorations(state) 累计调用次数 */
  decorationsCalls: number
  /** pluginView.update(view, prev) 累计耗时（毫秒） */
  pluginViewUpdateMs: number
  /** pluginView.update(view, prev) 累计调用次数 */
  pluginViewUpdateCalls: number
  /** spec.view(view) 累计耗时（毫秒）—— PM 走重建分支时调用 */
  specViewMs: number
  /** spec.view(view) 累计调用次数 */
  specViewCalls: number
}

/** docView 重建 / 增量更新阶段的统计 */
interface DocViewDiagnostics {
  /** docView.update 累计耗时（毫秒），如果返回 true 说明走增量更新成功 */
  updateMs: number
  /** docView.update 调用次数（理论上每次 view.update 调一次） */
  updateCalls: number
  /** docView.update 返回 false 的次数（走 destroy 后 docViewDesc 重建） */
  updateFailures: number
  /** docView.destroy 耗时（毫秒） */
  destroyMs: number
  /** docView.destroy 调用次数 */
  destroyCalls: number
}

/** view.dom 上 DOM 写操作的统计 */
interface DomWriteDiagnostics {
  appendChildCalls: number
  appendChildMs: number
  insertBeforeCalls: number
  insertBeforeMs: number
  removeChildCalls: number
  removeChildMs: number
}

/** 各 NodeType.toDOM 调用统计（按类型名聚合） */
interface ToDomDiagnostics {
  /** key = nodeType.name */
  byType: Map<string, { calls: number; totalMs: number }>
  /** 总调用次数 */
  totalCalls: number
  /** 总耗时（毫秒） */
  totalMs: number
}

export interface DirectStateViewUpdateBreakdown {
  /** 整个 operation 的总耗时（毫秒） */
  totalMs: number
  /** 所有 plugin.decorations 累计耗时（毫秒） */
  decorationsTotalMs: number
  /** 所有 pluginView.update 累计耗时（毫秒） */
  pluginViewUpdateTotalMs: number
  /** 所有 plugin.spec.view 累计耗时（PM 走重建分支时） */
  specViewTotalMs: number
  /** docView 增量更新 + 重建相关耗时 */
  docView: DocViewDiagnostics
  /** view.dom 上 DOM 写操作统计（次数，非耗时） */
  domWrites: DomWriteDiagnostics
  /** 各 nodeType.toDOM 调用统计（默认渲染路径，例如 baseBlock 走的就是这条） */
  toDom: ToDomDiagnostics
  /** 总耗时扣除所有已计入项后剩余 */
  otherMs: number
  /** 按 pluginKey 分组的明细 */
  entries: DiagnosticEntry[]
}

// ==================== 内部辅助 ====================

/**
 * 安全读取 EditorView 上的 pluginViews 数组。
 *
 * 中文说明：`pluginViews` 是 ProseMirror EditorView 的内部字段（dist/index.js 5361 行），
 * 不在公开类型中。这里做 type guard，避免直接 any 断言。
 */
function getEditorViewPluginViews(view: EditorViewLike): PluginViewHandleLike[] | null {
  const record = view as unknown as Record<string, unknown>
  const candidate = record.pluginViews
  if (!Array.isArray(candidate)) return null
  return candidate as PluginViewHandleLike[]
}

/**
 * 从 plugin 上读取 `key` 字段（plugin 唯一标识，由 ProseMirror 在构造时生成）。
 * 不存在时回退到 `'(unnamed)'`。
 */
function getPluginKey(plugin: ProseMirrorPlugin): string {
  const record = plugin as unknown as Record<string, unknown>
  const rawKey = record.key
  if (typeof rawKey === 'string') return rawKey
  return '(unnamed)'
}

/** 从 plugin 上读取 props.decorations（如果未定义返回 null） */
function getPluginDecorationsProp(plugin: ProseMirrorPlugin): DecorationsFn | null {
  const propsRecord = plugin.props as Record<string, unknown> | undefined
  if (!propsRecord) return null
  const candidate = propsRecord.decorations
  if (typeof candidate !== 'function') return null
  return candidate as DecorationsFn
}

/** 设置 plugin.props.decorations，断言其 props 必然存在 */
function setPluginDecorationsProp(plugin: ProseMirrorPlugin, fn: DecorationsFn): void {
  const propsRecord = plugin.props as Record<string, unknown> | undefined
  if (!propsRecord) return
  propsRecord.decorations = fn
}

/** 工厂：创建一个空的 DiagnosticEntry */
function createEntry(pluginKey: string): DiagnosticEntry {
  return {
    pluginKey,
    decorationsMs: 0,
    decorationsCalls: 0,
    pluginViewUpdateMs: 0,
    pluginViewUpdateCalls: 0,
    specViewMs: 0,
    specViewCalls: 0,
  }
}

// ==================== 核心包装 ====================

/**
 * 在 operation 执行期间，临时包装所有 plugin 的 `props.decorations` 与
 * `view.pluginViews[i].update`，统计每个 plugin 的耗时。
 *
 * @param view 要诊断的 ProseMirror EditorView（必须已经有 state.plugins）
 * @param operation 真正会触发 `view.update` / `view.updateState` 的操作
 * @returns 诊断结果（包含每个 plugin 的耗时分项）
 */
export function instrumentDirectStateViewUpdate(
  view: EditorViewLike,
  operation: () => void
): DirectStateViewUpdateBreakdown {
  const docViewStats: DocViewDiagnostics = {
    updateMs: 0,
    updateCalls: 0,
    updateFailures: 0,
    destroyMs: 0,
    destroyCalls: 0,
  }
  const domWriteStats: DomWriteDiagnostics = {
    appendChildCalls: 0,
    appendChildMs: 0,
    insertBeforeCalls: 0,
    insertBeforeMs: 0,
    removeChildCalls: 0,
    removeChildMs: 0,
  }
  const toDomStats: ToDomDiagnostics = {
    byType: new Map(),
    totalCalls: 0,
    totalMs: 0,
  }

  // 中文说明：测试桩 / 早期初始化阶段，view.state 可能尚未存在；
  // 这种情况下退化为直接执行 operation，并返回空 breakdown，避免诊断逻辑反过来影响主链路。
  const plugins = view.state?.plugins
  if (!plugins || plugins.length === 0) {
    const totalStartedAt = performance.now()
    operation()
    const totalMs = performance.now() - totalStartedAt
    return {
      totalMs,
      decorationsTotalMs: 0,
      pluginViewUpdateTotalMs: 0,
      specViewTotalMs: 0,
      docView: docViewStats,
      domWrites: domWriteStats,
      toDom: toDomStats,
      otherMs: totalMs,
      entries: [],
    }
  }

  const pluginViews = getEditorViewPluginViews(view)

  const entriesByKey = new Map<string, DiagnosticEntry>()
  const restorers: Array<() => void> = []

  // 1) 包装每个 plugin 的 props.decorations
  for (const plugin of plugins) {
    const pluginKey = getPluginKey(plugin)
    const originalDecorations = getPluginDecorationsProp(plugin)
    if (!originalDecorations) continue

    const entry = entriesByKey.get(pluginKey) ?? createEntry(pluginKey)
    entriesByKey.set(pluginKey, entry)

    const wrapped: DecorationsFn = (state) => {
      const startedAt = performance.now()
      try {
        return originalDecorations(state)
      } finally {
        entry.decorationsMs += performance.now() - startedAt
        entry.decorationsCalls += 1
      }
    }

    setPluginDecorationsProp(plugin, wrapped)
    restorers.push(() => {
      setPluginDecorationsProp(plugin, originalDecorations)
    })
  }

  // 2) 包装每个 plugin.spec.view —— PM 走 destroy+重建分支时会调它创建新 pluginView。
  //
  // 中文说明：direct-state 路径下 `EditorState.create({ plugins })` 会重建 Configuration.plugins 数组，
  // 导致 PM 在 updatePluginViews 走 destroy + 重新调 spec.view 分支。这里量化每个 spec.view 的耗时。
  for (const plugin of plugins) {
    const pluginKey = getPluginKey(plugin)
    const spec = plugin.spec as { view?: unknown }
    const originalSpecView = spec.view
    if (typeof originalSpecView !== 'function') continue

    const entry = entriesByKey.get(pluginKey) ?? createEntry(pluginKey)
    entriesByKey.set(pluginKey, entry)

    spec.view = function wrappedSpecView(...args: unknown[]): unknown {
      const startedAt = performance.now()
      try {
        return (originalSpecView as (...a: unknown[]) => unknown).apply(spec, args)
      } finally {
        entry.specViewMs += performance.now() - startedAt
        entry.specViewCalls += 1
      }
    }

    restorers.push(() => {
      spec.view = originalSpecView
    })
  }

  // 3) 包装 view.pluginViews 上每个 pluginView 的 update
  //    direct-state 路径下 plugins 不变，所以现有 pluginViews 数组就是 view.update 会调用的目标。
  //    pluginView 与 plugin 的顺序关系：updatePluginViews 在 spec.view 存在时按 directPlugins → state.plugins 顺序 push。
  //    这里不强求一一对应（仅做匿名标号），匿名标号通过 pluginKey 后续映射回 plugin 名。
  if (pluginViews) {
    // 中文说明：以 pluginViews 数组顺序，映射到 plugins 数组中“具有 spec.view 的 plugin”顺序。
    const pluginsWithView: ProseMirrorPlugin[] = []
    for (const plugin of plugins) {
      const spec = plugin.spec as Record<string, unknown>
      if (spec && typeof spec.view === 'function') {
        pluginsWithView.push(plugin)
      }
    }

    pluginViews.forEach((handle, index) => {
      const originalUpdate = handle.update
      if (typeof originalUpdate !== 'function') return

      const plugin = pluginsWithView[index]
      const pluginKey = plugin ? getPluginKey(plugin) : `(pluginView#${index})`

      const entry = entriesByKey.get(pluginKey) ?? createEntry(pluginKey)
      entriesByKey.set(pluginKey, entry)

      const wrappedUpdate = function wrappedPluginViewUpdate(
        v: EditorViewLike,
        prevState: EditorState
      ): void {
        const startedAt = performance.now()
        try {
          originalUpdate.call(handle, v, prevState)
        } finally {
          entry.pluginViewUpdateMs += performance.now() - startedAt
          entry.pluginViewUpdateCalls += 1
        }
      }

      handle.update = wrappedUpdate
      restorers.push(() => {
        handle.update = originalUpdate
      })
    })
  }

  // 4) 包装 view.docView.update / destroy，测量增量更新 vs 重建分支
  const docView = view.docView
  if (docView) {
    const originalUpdate = docView.update
    if (typeof originalUpdate === 'function') {
      docView.update = function wrappedDocViewUpdate(...args: unknown[]): unknown {
        const startedAt = performance.now()
        try {
          const ret = originalUpdate.apply(docView, args)
          if (ret === false) docViewStats.updateFailures += 1
          return ret
        } finally {
          docViewStats.updateMs += performance.now() - startedAt
          docViewStats.updateCalls += 1
        }
      }
      restorers.push(() => {
        if (docView) docView.update = originalUpdate
      })
    }

    const originalDestroy = docView.destroy
    if (typeof originalDestroy === 'function') {
      docView.destroy = function wrappedDocViewDestroy(...args: unknown[]): unknown {
        const startedAt = performance.now()
        try {
          return originalDestroy.apply(docView, args)
        } finally {
          docViewStats.destroyMs += performance.now() - startedAt
          docViewStats.destroyCalls += 1
        }
      }
      restorers.push(() => {
        if (docView) docView.destroy = originalDestroy
      })
    }
  }

  // 5) 包装 view.dom 上 DOM 写操作（仅计数，不记耗时——记 timing 会引入 monkey-patch 的微秒级抖动）
  //
  // 中文说明：renderDescs 把 NodeView 的 dom 插入 view.dom（contentDOM）。
  // 但子节点（baseBlock 之类）的 DOM 是用各自的 outer/inner 拼装出来，
  // 这些 appendChild 发生在“游离 DOM”上，不会触达 view.dom。这里只统计 view.dom 自身的写入，
  // 大致等于“真正会触发 layout invalidation 的次数”。
  const viewDom = view.dom
  if (viewDom) {
    const originalAppendChild = viewDom.appendChild
    if (typeof originalAppendChild === 'function') {
      viewDom.appendChild = function wrappedAppendChild(node: Node): Node {
        const startedAt = performance.now()
        try {
          return originalAppendChild.call(viewDom, node)
        } finally {
          domWriteStats.appendChildMs += performance.now() - startedAt
          domWriteStats.appendChildCalls += 1
        }
      }
      restorers.push(() => {
        if (viewDom) viewDom.appendChild = originalAppendChild
      })
    }

    const originalInsertBefore = viewDom.insertBefore
    if (typeof originalInsertBefore === 'function') {
      viewDom.insertBefore = function wrappedInsertBefore(node: Node, child: Node | null): Node {
        const startedAt = performance.now()
        try {
          return originalInsertBefore.call(viewDom, node, child)
        } finally {
          domWriteStats.insertBeforeMs += performance.now() - startedAt
          domWriteStats.insertBeforeCalls += 1
        }
      }
      restorers.push(() => {
        if (viewDom) viewDom.insertBefore = originalInsertBefore
      })
    }

    const originalRemoveChild = viewDom.removeChild
    if (typeof originalRemoveChild === 'function') {
      viewDom.removeChild = function wrappedRemoveChild(child: Node): Node {
        const startedAt = performance.now()
        try {
          return originalRemoveChild.call(viewDom, child)
        } finally {
          domWriteStats.removeChildMs += performance.now() - startedAt
          domWriteStats.removeChildCalls += 1
        }
      }
      restorers.push(() => {
        if (viewDom) viewDom.removeChild = originalRemoveChild
      })
    }
  }

  // 6) 包装 schema.nodes[*].spec.toDOM
  //
  // 中文说明：BaseBlock 这类节点没有 addNodeView，PM 走默认路径会调 `node.type.spec.toDOM(node)` 创建 DOM。
  // 这里逐个包装，量化 default-toDOM 路径的真实耗时。
  const schema = view.state?.schema as unknown as { nodes?: Record<string, NodeTypeLike> }
  if (schema?.nodes) {
    for (const typeName in schema.nodes) {
      const nodeType = schema.nodes[typeName]
      const spec = nodeType?.spec as { toDOM?: unknown } | undefined
      if (!spec) continue
      const originalToDOM = spec.toDOM
      if (typeof originalToDOM !== 'function') continue

      spec.toDOM = function wrappedToDOM(...args: unknown[]): unknown {
        const startedAt = performance.now()
        try {
          return (originalToDOM as (...a: unknown[]) => unknown).apply(spec, args)
        } finally {
          const elapsed = performance.now() - startedAt
          const entry = toDomStats.byType.get(typeName) ?? { calls: 0, totalMs: 0 }
          entry.calls += 1
          entry.totalMs += elapsed
          toDomStats.byType.set(typeName, entry)
          toDomStats.totalCalls += 1
          toDomStats.totalMs += elapsed
        }
      }

      restorers.push(() => {
        spec.toDOM = originalToDOM
      })
    }
  }

  // 7) 执行 operation 并保证 finally 恢复
  const totalStartedAt = performance.now()
  try {
    operation()
  } finally {
    for (const restore of restorers) {
      try {
        restore()
      } catch (error) {
        console.warn('[EditorDirectStateDiagnostics] 恢复 plugin 包装失败：', error)
      }
    }
  }
  const totalMs = performance.now() - totalStartedAt

  // 8) 汇总
  const entries = Array.from(entriesByKey.values())
  const decorationsTotalMs = entries.reduce((sum, e) => sum + e.decorationsMs, 0)
  const pluginViewUpdateTotalMs = entries.reduce((sum, e) => sum + e.pluginViewUpdateMs, 0)
  const specViewTotalMs = entries.reduce((sum, e) => sum + e.specViewMs, 0)
  const otherMs = Math.max(
    0,
    totalMs -
      decorationsTotalMs -
      pluginViewUpdateTotalMs -
      specViewTotalMs -
      docViewStats.updateMs -
      docViewStats.destroyMs
  )

  return {
    totalMs,
    decorationsTotalMs,
    pluginViewUpdateTotalMs,
    specViewTotalMs,
    docView: docViewStats,
    domWrites: domWriteStats,
    toDom: toDomStats,
    otherMs,
    entries,
  }
}

// ==================== 报告输出 ====================

/**
 * 把 breakdown 打到控制台。
 *
 * 中文说明：与 editorOpenPerf 的报告分开，避免污染主报告字段；
 * 也方便用户在生产环境下用 `__EDITOR_DIRECT_STATE_DIAG__` 控制开关。
 */
export function printDirectStateViewUpdateBreakdown(
  breakdown: DirectStateViewUpdateBreakdown,
  rootBlockCount: number
): void {
  const sorted = [...breakdown.entries].sort((a, b) => {
    const aTotal = a.decorationsMs + a.pluginViewUpdateMs + a.specViewMs
    const bTotal = b.decorationsMs + b.pluginViewUpdateMs + b.specViewMs
    return bTotal - aTotal
  })

  console.group(
    `[EditorDirectStateDiag] view.update 拆解 (rootBlockCount=${rootBlockCount}, total=${breakdown.totalMs.toFixed(1)}ms)`
  )

  console.log(
    `汇总: decorations=${breakdown.decorationsTotalMs.toFixed(1)}ms,`,
    `pluginView.update=${breakdown.pluginViewUpdateTotalMs.toFixed(1)}ms,`,
    `spec.view=${breakdown.specViewTotalMs.toFixed(1)}ms,`,
    `docView.update=${breakdown.docView.updateMs.toFixed(1)}ms (x${breakdown.docView.updateCalls}, 失败 ${breakdown.docView.updateFailures}),`,
    `docView.destroy=${breakdown.docView.destroyMs.toFixed(1)}ms (x${breakdown.docView.destroyCalls}),`,
    `其他=${breakdown.otherMs.toFixed(1)}ms`
  )
  console.log(
    `view.dom 写操作:`,
    `appendChild=${breakdown.domWrites.appendChildMs.toFixed(1)}ms (x${breakdown.domWrites.appendChildCalls})`,
    `insertBefore=${breakdown.domWrites.insertBeforeMs.toFixed(1)}ms (x${breakdown.domWrites.insertBeforeCalls})`,
    `removeChild=${breakdown.domWrites.removeChildMs.toFixed(1)}ms (x${breakdown.domWrites.removeChildCalls})`
  )

  const toDomSorted = Array.from(breakdown.toDom.byType.entries()).sort(
    (a, b) => b[1].totalMs - a[1].totalMs
  )
  console.log(
    `schema.toDOM 总: ${breakdown.toDom.totalMs.toFixed(1)}ms (x${breakdown.toDom.totalCalls})`
  )
  for (const [typeName, entry] of toDomSorted) {
    if (entry.totalMs < 0.5 && entry.calls < 1000) continue
    console.log(
      `  ${typeName}: ${entry.totalMs.toFixed(1)}ms (x${entry.calls}, avg=${(entry.totalMs / entry.calls).toFixed(3)}ms)`
    )
  }

  for (const entry of sorted) {
    const total = entry.decorationsMs + entry.pluginViewUpdateMs + entry.specViewMs
    if (total < 0.5) continue
    console.log(
      `${entry.pluginKey}: total=${total.toFixed(1)}ms`,
      `decorations=${entry.decorationsMs.toFixed(1)}ms (x${entry.decorationsCalls})`,
      `pluginView.update=${entry.pluginViewUpdateMs.toFixed(1)}ms (x${entry.pluginViewUpdateCalls})`,
      `spec.view=${entry.specViewMs.toFixed(1)}ms (x${entry.specViewCalls})`
    )
  }

  console.groupEnd()
}

// ==================== 运行时开关 ====================

/**
 * 是否启用 direct-state 诊断。
 *
 * 中文说明：默认开启（开发期反复诊断）；用户可以在控制台执行
 *   window.__EDITOR_DIRECT_STATE_DIAG__ = false
 * 关闭。
 */
export function isDirectStateDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const record = window as unknown as Record<string, unknown>
  if (record.__EDITOR_DIRECT_STATE_DIAG__ === false) return false
  return true
}

if (typeof window !== 'undefined') {
  const record = window as unknown as Record<string, unknown>
  if (record.__EDITOR_DIRECT_STATE_DIAG__ === undefined) {
    record.__EDITOR_DIRECT_STATE_DIAG__ = true
  }
}
