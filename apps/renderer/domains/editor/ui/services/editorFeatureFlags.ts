/**
 * editorFeatureFlags.ts
 *
 * 编辑器 Shell 化架构的 feature flag 集中管理。
 *
 * 设计原则：
 * - 零外部依赖：不引用 Vue / Tiptap / Store
 * - 运行时可切换：便于开发/调试时热切
 * - 默认值必须配合运行态门控：即使某些子能力默认开启，也只能在明确的 Shell / 大文档运行态生效
 * - 单一事实来源：其他模块只通过本文件读取开关状态
 */

// ==================== 开关定义 ====================

export interface EditorShellFlags {
  /**
   * Phase 1：rootBlock 使用轻量 Shell NodeView（取代 Vue BlockView）
   * 默认 false，开启后 RootBlock.addNodeView 走原生 DOM RootBlockShellView。
   * 中文说明：该路径用于压测超大文档 setContent 基线；暂不提供 BlockChrome 行为。
   */
  rootBlockShellEnabled: boolean

  /**
   * 大文档自动启用大文档运行态。
   * 中文说明：这是运行时自动模式，不修改 rootBlockShellEnabled 的手动压测开关值；
   * 当前主路线会继续进入 virtualRootBlockRendering，而不是把大文档强制切到 RootBlockShellView。
   */
  autoRootBlockShellForLargeDocuments: boolean

  /**
   * Phase 2：Editor 级单例 Block Chrome 层
   * 中文说明：
   * - 仅在 rootBlock Shell / 渲染虚拟化运行态下生效；
   * - 小文档仍走 Vue BlockView + BlockChrome，不会出现双份 UI。
   */
  blockChromeLayerEnabled: boolean

  /**
   * Phase 2 子开关：修订 UI 使用单例 overlay。
   * 中文说明：大文档去掉每块 Vue NodeView 后，块级修订状态必须由 editor 级 overlay 补回。
   */
  revisionOverlayEnabled: boolean

  /**
   * 性能整治：Accept/Reject All 走后端 docJson 一次性合并。
   *
   * 中文说明：
   * - 开启后文档级接受/拒绝不会逐块 dispatch ProseMirror transaction；
   * - 若主进程通道不可用，RevisionStore 会回退旧路径；
   * - 可在 DevTools 中临时关闭，用于对比性能或排查回归。
   */
  enableBackendPendingApply: boolean

  /**
   * 大文档打开时只建立 pending canonical 索引，暂缓全文档 revisionMark 投影。
   * 中文说明：10000 块/10000 pending 不应在首开阶段同步改写整棵 ProseMirror doc。
   */
  deferPendingProjectionForLargeDocuments: boolean

  /**
   * 大文档首开直接重建 EditorState，绕过 Tiptap setContent 的全文 replaceWith。
   * 中文说明：这只用于“切换/打开新文档”，不是普通编辑命令。
   */
  useDirectStateDocumentLoadForLargeDocuments: boolean

  /**
   * R0：direct-state 新 EditorState 复用上一份 plugins 数组引用。
   * 中文说明：ProseMirror 会用 `prev.plugins !== next.plugins` 判断插件是否变化；
   * 对“只替换 doc、不替换插件”的文档打开场景，稳定引用可以避免误触发 nodeViews 重建分支。
   */
  stabilizeDirectStatePluginsForLargeDocuments: boolean

  /**
   * R0：direct-state 的 view.update 期间临时把 editor DOM 从文档流摘下。
   * 中文说明：用于压低 10000 rootBlock 首开时大量 insertBefore 对浏览器 layout/style 的冲击。
   */
  detachDirectStateDomForLargeDocuments: boolean

  /**
   * R1：rootBlock 渲染虚拟化。
   * 中文说明：开启后，RenderVirtualization 插件可以把离屏 rootBlock 切成无 contentDOM 的 placeholder。
   * 当前默认开启，但必须同时满足当前文档进入 virtualRootBlockRenderingActive 运行态；
   * 小文档和非 direct-state 文档仍保持 hydrated 路径。
   */
  virtualRootBlockRendering: boolean

  /**
   * Revision 细粒度调试日志。
   * 中文说明：默认关闭。只有排查 diff / projection 细节时手动打开，避免大批量 pending 滚动时 console 刷屏拖慢主线程。
   */
  revisionDebugLogging: boolean

  /**
   * 渲染虚拟化运行时调试日志。
   * 中文说明：默认关闭。开启后也会节流输出，完整样本通过 window 诊断 API 查看。
   */
  renderVirtualizationDebugLogging: boolean
}

// ==================== 内部状态 ====================

const _flags: EditorShellFlags = {
  rootBlockShellEnabled: false,
  autoRootBlockShellForLargeDocuments: true,
  blockChromeLayerEnabled: true,
  revisionOverlayEnabled: true,
  enableBackendPendingApply: true,
  deferPendingProjectionForLargeDocuments: true,
  useDirectStateDocumentLoadForLargeDocuments: true,
  stabilizeDirectStatePluginsForLargeDocuments: true,
  detachDirectStateDomForLargeDocuments: true,
  virtualRootBlockRendering: true,
  revisionDebugLogging: false,
  renderVirtualizationDebugLogging: false,
}

let _largeDocumentShellModeActive = false
let _virtualRootBlockRenderingActive = false

export interface EditorShellRuntimeState {
  largeDocumentShellModeActive: boolean
  virtualRootBlockRenderingActive: boolean
}

type EditorShellRuntimeOwner = object

const editorRuntimeStates = new WeakMap<EditorShellRuntimeOwner, EditorShellRuntimeState>()

// ==================== 公共 API ====================

function logFeatureFlagChange(message: string): void {
  if (!_flags.renderVirtualizationDebugLogging) return
  console.info(message)
}

function createInactiveRuntimeState(): EditorShellRuntimeState {
  return {
    largeDocumentShellModeActive: false,
    virtualRootBlockRenderingActive: false,
  }
}

function getOrCreateEditorRuntimeState(owner: EditorShellRuntimeOwner): EditorShellRuntimeState {
  const current = editorRuntimeStates.get(owner)
  if (current) return current
  const next = createInactiveRuntimeState()
  editorRuntimeStates.set(owner, next)
  return next
}

function readEditorRuntimeState(owner: EditorShellRuntimeOwner | null | undefined): EditorShellRuntimeState {
  if (owner) {
    const scoped = editorRuntimeStates.get(owner)
    return scoped ?? createInactiveRuntimeState()
  }
  return {
    largeDocumentShellModeActive: _largeDocumentShellModeActive,
    virtualRootBlockRenderingActive: _virtualRootBlockRenderingActive,
  }
}

/**
 * 获取当前所有开关的只读快照。
 */
export function getEditorShellFlags(): Readonly<EditorShellFlags> {
  return { ..._flags }
}

/**
 * 读取单个开关值。
 */
export function getFlag(key: keyof EditorShellFlags): boolean {
  return _flags[key]
}

/**
 * 设置当前打开文档是否处于“大文档 Shell 模式”。
 * 该状态与手动 rootBlockShellEnabled 分离，避免压测开关和自动策略互相覆盖。
 */
export function setLargeDocumentShellMode(active: boolean): void {
  if (_largeDocumentShellModeActive === active) return
  _largeDocumentShellModeActive = active
  logFeatureFlagChange(`[EditorFeatureFlags] largeDocumentShellMode: ${active}`)
}

export function shouldUseRootBlockShell(): boolean {
  return _flags.rootBlockShellEnabled || _largeDocumentShellModeActive
}

/**
 * 设置某个 Editor 实例自己的“大文档 Shell 模式”运行态。
 *
 * 中文说明：feature flag 是全局能力开关，但运行态必须跟随 editor 实例；
 * 否则同屏多 editor 或测试并发 editor 会互相覆盖当前文档是否启用虚拟化。
 */
export function setLargeDocumentShellModeForOwner(
  owner: EditorShellRuntimeOwner,
  active: boolean
): void {
  const runtime = getOrCreateEditorRuntimeState(owner)
  if (runtime.largeDocumentShellModeActive === active) return
  runtime.largeDocumentShellModeActive = active
  logFeatureFlagChange(`[EditorFeatureFlags] largeDocumentShellMode(owner): ${active}`)
}

export function shouldUseRootBlockShellForOwner(
  owner?: EditorShellRuntimeOwner | null
): boolean {
  const runtime = readEditorRuntimeState(owner)
  return _flags.rootBlockShellEnabled || runtime.largeDocumentShellModeActive
}

/**
 * 设置当前文档是否处于 rootBlock 渲染虚拟化运行态。
 * 中文说明：feature flag 只是“允许能力存在”，active 表示“当前文档真的按虚拟化协议加载”。
 */
export function setVirtualRootBlockRenderingActive(active: boolean): void {
  if (_virtualRootBlockRenderingActive === active) return
  _virtualRootBlockRenderingActive = active
  logFeatureFlagChange(`[EditorFeatureFlags] virtualRootBlockRenderingActive: ${active}`)
}

export function shouldUseVirtualRootBlockRendering(): boolean {
  return _flags.virtualRootBlockRendering && _virtualRootBlockRenderingActive
}

/**
 * 设置某个 Editor 实例自己的 rootBlock 渲染虚拟化运行态。
 *
 * 中文说明：这是第三轮审计指出的关键边界。新增主路径必须传 owner；
 * 不传 owner 的旧 API 只保留给单 editor legacy 路径与老测试。
 */
export function setVirtualRootBlockRenderingActiveForOwner(
  owner: EditorShellRuntimeOwner,
  active: boolean
): void {
  const runtime = getOrCreateEditorRuntimeState(owner)
  if (runtime.virtualRootBlockRenderingActive === active) return
  runtime.virtualRootBlockRenderingActive = active
  logFeatureFlagChange(`[EditorFeatureFlags] virtualRootBlockRenderingActive(owner): ${active}`)
}

export function shouldUseVirtualRootBlockRenderingForOwner(
  owner?: EditorShellRuntimeOwner | null
): boolean {
  const runtime = readEditorRuntimeState(owner)
  return _flags.virtualRootBlockRendering && runtime.virtualRootBlockRenderingActive
}

export function resetEditorShellRuntimeForOwner(owner: EditorShellRuntimeOwner): void {
  editorRuntimeStates.set(owner, createInactiveRuntimeState())
}

/**
 * 设置单个开关值。
 * 仅用于开发调试和压测对比，生产环境通过默认值控制。
 */
export function setFlag(key: keyof EditorShellFlags, value: boolean): void {
  const prev = _flags[key]
  _flags[key] = value
  if (prev !== value) {
    logFeatureFlagChange(`[EditorFeatureFlags] ${key}: ${prev} → ${value}`)
  }
}

/**
 * 批量设置开关值。
 */
export function setFlags(patch: Partial<EditorShellFlags>): void {
  for (const key of Object.keys(patch) as Array<keyof EditorShellFlags>) {
    if (patch[key] !== undefined) {
      setFlag(key, patch[key]!)
    }
  }
}

// ==================== 开发调试便利 ====================

/**
 * 挂到 window 上，方便在 DevTools console 中切换开关。
 * 示例：window.__EDITOR_FLAGS__.set('rootBlockShellEnabled', true)
 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__EDITOR_FLAGS__ = {
    get: getEditorShellFlags,
    getRuntime: () => ({
      largeDocumentShellModeActive: _largeDocumentShellModeActive,
      virtualRootBlockRenderingActive: _virtualRootBlockRenderingActive,
      shouldUseRootBlockShell: shouldUseRootBlockShell(),
      shouldUseVirtualRootBlockRendering: shouldUseVirtualRootBlockRendering(),
    }),
    set: setFlag,
    setAll: setFlags,
  }
}
