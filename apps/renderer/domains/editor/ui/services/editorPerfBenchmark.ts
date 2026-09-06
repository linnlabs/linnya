/**
 * editorPerfBenchmark.ts
 *
 * 编辑器首开性能压测工具。
 *
 * 设计原则：
 * - 仅供开发/调试使用，不参与生产构建
 * - 通过 window.__EDITOR_PERF_BENCH__ 在 DevTools 控制台调用
 * - 依赖 editorOpenPerf 的自动采集，本模块只负责「生成文档 + 触发加载 + 收集报告」
 * - 零 Vue 依赖，仅引用编辑器纯函数工具
 *
 * 使用方式（DevTools 控制台）：
 *
 *   // 生成 1000 块文档 JSON（不触发加载，仅返回 JSON）
 *   const doc = window.__EDITOR_PERF_BENCH__.generateDoc(1000)
 *
 *   // 生成并注入编辑器，自动采集性能报告
 *   window.__EDITOR_PERF_BENCH__.run(1000)
 *
 *   // 带 pending revisions 的场景
 *   window.__EDITOR_PERF_BENCH__.run(3000, { revisionRatio: 0.3 })
 *
 *   // 对比旧/新路径
 *   window.__EDITOR_PERF_BENCH__.runComparison(1000)
 */

import type { JSONContent, SetContentOptions } from '@tiptap/core'

import {
  getRenderVirtualizationBlockHeightCacheSnapshot,
  prepareInitialRenderVirtualizationState,
  resetRenderVirtualizationBlockHeightCache,
  shouldEnableVirtualRootBlockRendering,
} from '../../features/RenderVirtualization/internal'
import {
  countRootBlocksInDocJson,
  LARGE_DOCUMENT_ROOT_BLOCK_THRESHOLD,
  loadDocumentJsonViaDirectState,
  shouldUseDirectStateDocumentLoad,
  type EditorForDocumentStateLoad,
} from '../../services/editorDocumentStateLoader'
import {
  getFlag,
  setFlag,
  setLargeDocumentShellModeForOwner,
  setVirtualRootBlockRenderingActiveForOwner,
} from './editorFeatureFlags'
import {
  finalizeOpenPerf,
  measureSetContentOperation,
  resetOpenPerf,
  setDocInfo,
} from './editorOpenPerf'

// ==================== 类型定义 ====================

export type BenchmarkLoadMode = 'auto' | 'command' | 'direct-state'
export type BenchmarkPostLoadEventMode = 'sync' | 'skip' | 'timeout' | 'raf'

/** 压测配置 */
export interface BenchmarkOptions {
  /** 每隔多少块插入一个 heading（模拟目录结构），0 表示不插入 */
  headingInterval: number
  /** pending revision 占比（0~1），默认 0 */
  revisionRatio: number
  /** 是否包含代码块 */
  includeCodeBlocks: boolean
  /** 是否包含图片块占位 */
  includeImageBlocks: boolean
  /**
   * 文档注入路径。
   * 中文说明：默认 auto 必须复用产品真实路径；command 只用于对比旧的全量 Vue NodeView 路径。
   */
  loadMode: BenchmarkLoadMode
  /**
   * rootBlock id 盐值。
   * 中文说明：压测文档必须使用合法且每轮不同的 root-* id，避免 UniqueIdsExtension
   * 追加修复事务，也避免连续 scaleSuite 中不同规模文档复用同一批 NodeView。
   */
  blockIdSalt: string | null
  /** 是否输出虚拟化引擎逐步调试日志。默认关闭，避免日志本身干扰卡顿定位。 */
  debugRenderVirtualization: boolean
  /**
   * file-content-loaded 触发方式。
   * 中文说明：1500+ 大文档卡死目前发生在 setContent 返回后的事件循环阶段；
   * 这里允许把加载后事件链路单独切开，判断卡顿来自事件订阅、浏览器渲染，还是 Vue/PM 后续队列。
   */
  postLoadEventMode: BenchmarkPostLoadEventMode
  /**
   * 是否逐个输出 file-content-loaded 监听器的同步执行耗时。
   * 仅用于定位卡顿来源，默认关闭，避免基准数据被日志污染。
   */
  traceFileContentLoadedListeners: boolean
  /**
   * 跳过指定名字的 file-content-loaded 监听器。
   * 例如 ['onFileContentLoaded'] 可隔离 Shell pending 投影桥的加载后刷新链路。
   */
  skipFileContentLoadedListenerNames: string[]
}

export interface ManualBenchmarkSessionInput {
  label: string
  blockCount?: number
  scenario?: 'open' | 'scroll' | 'input' | 'selection' | 'drag' | 'custom'
  notes?: string
}

export interface ManualBenchmarkOperation {
  label: string
  startedAt: number
  endedAt: number
  durationMs: number
  startSnapshot: ManualBenchmarkProbeSnapshot
  endSnapshot: ManualBenchmarkProbeSnapshot
}

export interface ManualBenchmarkReport {
  label: string
  scenario: NonNullable<ManualBenchmarkSessionInput['scenario']>
  blockCount: number | null
  notes: string
  startedAt: string
  endedAt: string
  durationMs: number
  operations: ManualBenchmarkOperation[]
  finalSnapshot: ManualBenchmarkProbeSnapshot
  histories: ManualBenchmarkHistories
}

interface ManualBenchmarkNumericSummary {
  count: number
  avg: number | null
  max: number | null
  p95: number | null
}

interface ManualBenchmarkScrollSummary {
  start: ManualBenchmarkProbeSnapshot['scroll']
  end: ManualBenchmarkProbeSnapshot['scroll']
  scrollHeightDelta: number | null
  maxScrollTopDelta: number | null
}

interface ManualBenchmarkHeightCacheSummary {
  startAdaptiveHeight: number | null
  endAdaptiveHeight: number | null
  startMeasuredCount: number | null
  endMeasuredCount: number | null
}

export interface ManualBenchmarkCompactSummary {
  label: string
  scenario: ManualBenchmarkReport['scenario']
  blockCount: number | null
  durationMs: number
  operationMs: number | null
  open: {
    method: string | null
    rootBlocks: number | null
    setContentMs: number | null
    viewUpdateMs: number | null
    nonViewMs: number | null
  }
  scroll: ManualBenchmarkScrollSummary
  heightCache: ManualBenchmarkHeightCacheSummary
  finalDom: {
    rootBlocks: number | null
    hydratedDom: number | null
    placeholderDom: number | null
  }
  finalNodeView: {
    activeTotal: number | null
    vue: number | null
    placeholder: number | null
  }
  viewportTracker: {
    eventCount: number
    decisionCounts: Record<string, number>
    delta: ManualBenchmarkNumericSummary
    correctionDelta: ManualBenchmarkNumericSummary
    correctionDistance: ManualBenchmarkNumericSummary
    lastDecision: string | null
  }
  renderVirtualization: {
    eventCount: number
    reasonCounts: Record<string, number>
    sourceCounts: Record<string, number>
    duration: ManualBenchmarkNumericSummary
    requestedHydrate: ManualBenchmarkNumericSummary
    requestedDehydrate: ManualBenchmarkNumericSummary
    totalEstimatedHeight: ManualBenchmarkNumericSummary
    lastEstimatedHeight: number | null
    lastHydratedCount: number | null
  }
}

export interface AutomatedScrollBenchmarkOptions {
  label?: string
  blockCount?: number
  /** 单独跑 scroll 时，是否自动准备指定规模文档。默认：传入 blockCount 时启用。 */
  prepareDocument?: boolean
  /** 自动准备文档时透传给 runBenchmark 的生成 / 加载选项。 */
  benchmarkOptions?: Partial<BenchmarkOptions>
  /** 自动准备文档后等待首帧稳定的时间。 */
  openSettleMs?: number
  stepPx?: number
  frameDelayMs?: number
  settleMs?: number
  maxDurationMs?: number
  direction?: 'down' | 'up'
  notes?: string
}

export interface AutomatedOpenBenchmarkOptions {
  label?: string
  blockCount: number
  settleMs?: number
  benchmarkOptions?: Partial<BenchmarkOptions>
  disableInitialBlockChromeMount?: boolean
  disableBlockViewPostMountWork?: boolean
  logBlockViewMountMicrotasks?: boolean
  debugEventLoopProbe?: boolean
  notes?: string
}

export interface DetachedOpenBenchmarkHandle {
  label: string
  blockCount: number
  settleMs: number
  status: 'scheduled'
  readReport: () => ManualBenchmarkReport | null
}

export interface AutomatedMenuBenchmarkOptions {
  label?: string
  blockCount?: number
  settleMs?: number
  notes?: string
}

export interface AutomatedAnnotationBenchmarkOptions {
  label?: string
  blockCount?: number
  settleMs?: number
  notes?: string
}

export interface AutomatedScaleSuiteOptions {
  blockCounts?: number[]
  scenarios?: Array<'open' | 'scroll' | 'menu' | 'annotation'>
  scrollStepPx?: number
  settleMs?: number
  benchmarkOptions?: Partial<BenchmarkOptions>
}

interface ManualBenchmarkSessionState {
  input: Required<ManualBenchmarkSessionInput>
  startedAt: number
  startSnapshot: ManualBenchmarkProbeSnapshot
  operations: ManualBenchmarkOperation[]
  activeOperation: {
    label: string
    startedAt: number
    startSnapshot: ManualBenchmarkProbeSnapshot
  } | null
}

interface ManualBenchmarkProbeSnapshot {
  timestamp: string
  openPerf: unknown | null
  virtualizationDiag: unknown | null
  renderVirtualization: unknown | null
  viewportTracker: unknown | null
  heightCache: unknown | null
  scroll: {
    scrollTop: number | null
    scrollHeight: number | null
    clientHeight: number | null
    maxScrollTop: number | null
  }
  nodeView: unknown | null
  blockChrome: {
    lifecycleActiveCount: number | null
    lifecycleLast: unknown | null
    activation: unknown | null
    editorListeners: unknown | null
  }
  decoration: {
    last: unknown | null
    summary: unknown | null
  }
  drag: {
    lastDragOver: unknown | null
    lastDragAction: unknown | null
  }
  memory: {
    renderer: unknown | null
    electron: unknown | null
  }
}

interface ManualBenchmarkHistories {
  renderVirtualization: unknown[]
  viewportTracker: unknown[]
  decoration: unknown[]
  dragOver: unknown[]
  dragAction: unknown[]
  blockChromeLifecycle: unknown[]
  blockActivation: unknown[]
  editorListeners: unknown[]
  blockActionMenu: unknown[]
  annotationInteraction: unknown[]
}

interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

interface IdleSchedulerGlobal {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number }
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

/** 文档 JSON 中的节点结构 */
interface DocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

interface BenchmarkEditor extends EditorForDocumentStateLoad {
  commands: {
    setContent: (content: JSONContent, options?: SetContentOptions) => void
  }
  eventBus?: {
    emit?: (eventName: string) => void
    listeners?: Record<string, unknown>
  }
  isDestroyed?: boolean
}

interface EditorPerfBenchmarkControl {
  disableInitialBlockChromeMount?: boolean
  disableBlockViewPostMountWork?: boolean
  logBlockViewMountMicrotasks?: boolean
}

interface EditorPerfBenchmarkControlWindow {
  __EDITOR_PERF_BENCH_CONTROL__?: EditorPerfBenchmarkControl
  __EDITOR_BLOCK_VIEW_MOUNT_MICROTASK_COUNT__?: number
}

// ==================== 默认配置 ====================

const DEFAULT_OPTIONS: BenchmarkOptions = {
  headingInterval: 20,
  revisionRatio: 0,
  includeCodeBlocks: false,
  includeImageBlocks: false,
  loadMode: 'auto',
  blockIdSalt: null,
  debugRenderVirtualization: false,
  postLoadEventMode: 'sync',
  traceFileContentLoadedListeners: false,
  skipFileContentLoadedListenerNames: [],
}

const DEFAULT_MANUAL_INPUT: Required<ManualBenchmarkSessionInput> = {
  label: 'manual-benchmark',
  blockCount: 0,
  scenario: 'custom',
  notes: '',
}

const DEFAULT_AUTO_SCROLL_MAX_DURATION_MS = 60_000
const DEFAULT_AUTO_SCROLL_SETTLE_MS = 500
const DEFAULT_AUTO_OPEN_SETTLE_MS = 1000
const DEFAULT_AUTO_MENU_SETTLE_MS = 300
const DEFAULT_AUTO_ANNOTATION_SETTLE_MS = 800
const DEFAULT_SCALE_SUITE_BLOCK_COUNTS = [500, 1500, 5000, 10000]

let currentManualSession: ManualBenchmarkSessionState | null = null
let lastDetachedOpenReport: ManualBenchmarkReport | null = null

// ==================== 文档生成 ====================

/** 生成本轮压测 rootBlock id 盐值，保持合法 root-* 格式且避免跨轮复用 NodeView。 */
function makeBlockIdSalt(): string {
  const randomValue = Math.floor(Math.random() * 0xfff)
  return randomValue.toString(16).padStart(3, '0')
}

function normalizeBlockIdSalt(value: string | null | undefined): string {
  if (typeof value !== 'string') return makeBlockIdSalt()
  const normalized = value.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 3)
  return normalized.padEnd(3, '0') || makeBlockIdSalt()
}

/** 生成合法 rootBlock ID。 */
function makeBlockId(index: number, salt: string): string {
  const sequence = Math.max(0, index % 0xfffff).toString(16).padStart(5, '0')
  return `root-${salt}${sequence}`
}

/** 生成一段随机中英文混排文本 */
function makeParagraphText(index: number): string {
  const templates = [
    `这是第 ${index} 个段落，包含一些中文内容和 English words。`,
    `Block #${index}: Lorem ipsum dolor sit amet, 测试文本用于性能基线。`,
    `第 ${index} 段：The quick brown fox jumps over the lazy dog. 快速的棕色狐狸。`,
    `性能压测内容 ${index}：ProseMirror NodeView 创建成本分析。`,
    `Paragraph ${index}: 编辑器支持 Markdown、代码块、公式等多种块类型。`,
  ]
  return templates[index % templates.length]
}

/** 生成 heading 内容块 */
function makeHeadingBlock(index: number, level: number): DocNode {
  return {
    type: 'headingBlock',
    attrs: { level, blockType: 'heading' },
    content: [
      { type: 'text', text: `章节 ${Math.floor(index / 20) + 1}：性能压测标题` },
    ],
  }
}

/** 生成普通段落内容块 */
function makeBaseBlock(index: number): DocNode {
  return {
    type: 'baseBlock',
    attrs: { blockType: 'base' },
    content: [
      { type: 'text', text: makeParagraphText(index) },
    ],
  }
}

/** 生成代码块内容 */
function makeCodeBlock(index: number): DocNode {
  return {
    type: 'codeBlock',
    attrs: { language: 'javascript', blockType: 'code' },
    content: [
      {
        type: 'text',
        text: `// Block ${index}\nfunction benchmark_${index}() {\n  console.log('perf test');\n  return ${index};\n}`,
      },
    ],
  }
}

/** 包裹为 rootBlock */
function wrapInRootBlock(contentBlock: DocNode, blockId: string): DocNode {
  return {
    type: 'rootBlock',
    attrs: {
      id: blockId,
      annotations: [],
      position: null,
      isDragging: false,
      backgroundColor: null,
      textColor: null,
    },
    content: [contentBlock],
  }
}

/**
 * 生成指定块数的文档 JSON。
 * 返回完整的 ProseMirror doc 结构。
 */
export function generateBenchmarkDoc(
  blockCount: number,
  userOptions?: Partial<BenchmarkOptions>
): DocNode {
  const opts = { ...DEFAULT_OPTIONS, ...userOptions }
  const blockIdSalt = normalizeBlockIdSalt(opts.blockIdSalt)
  const blocks: DocNode[] = []

  for (let i = 0; i < blockCount; i++) {
    const blockId = makeBlockId(i, blockIdSalt)
    let contentBlock: DocNode

    if (opts.headingInterval > 0 && i % opts.headingInterval === 0) {
      contentBlock = makeHeadingBlock(i, i === 0 ? 1 : 2)
    } else if (opts.includeCodeBlocks && i % 15 === 7) {
      contentBlock = makeCodeBlock(i)
    } else {
      contentBlock = makeBaseBlock(i)
    }

    blocks.push(wrapInRootBlock(contentBlock, blockId))
  }

  return {
    type: 'doc',
    content: blocks,
  }
}

/**
 * 生成模拟 pending revisions 数组。
 * 随机选取 blockCount * ratio 个块添加 revision。
 */
export function generateMockRevisions(
  blockCount: number,
  ratio: number,
  blockIdSalt?: string | null
): Array<{
  blockId: string
  status: string
  diff: { type: string; content: string }[]
  createdAt: string
}> {
  if (ratio <= 0) return []

  const count = Math.max(1, Math.floor(blockCount * Math.min(ratio, 1)))
  const revisions: Array<{
    blockId: string
    status: string
    diff: { type: string; content: string }[]
    createdAt: string
  }> = []

  // 均匀分布选取
  const normalizedBlockIdSalt = normalizeBlockIdSalt(blockIdSalt)
  const step = Math.max(1, Math.floor(blockCount / count))
  for (let i = 0; i < count && i * step < blockCount; i++) {
    const blockIndex = i * step
    revisions.push({
      blockId: makeBlockId(blockIndex, normalizedBlockIdSalt),
      status: 'pending',
      diff: [
        { type: 'insert', content: `新增内容 #${blockIndex}` },
        { type: 'delete', content: `删除内容 #${blockIndex}` },
      ],
      createdAt: new Date().toISOString(),
    })
  }

  return revisions
}

// ==================== 压测执行 ====================

/**
 * 获取当前 Tiptap editor 实例。
 * 遍历已知的挂载点查找。
 */
function getEditorInstance(): unknown | null {
  // Tiptap 编辑器实例通常挂在 .ProseMirror 的父元素上
  const proseMirrorEl = document.querySelector('.ProseMirror')
  if (!proseMirrorEl) {
    console.error('[PerfBench] 未找到 .ProseMirror 元素，编辑器可能未挂载')
    return null
  }

  // 从 __vue_app__ 或全局变量中获取编辑器实例
  // 这里做一个通用的查找
  const win = window as unknown as Record<string, unknown>
  if (win.__TIPTAP_EDITOR__) {
    return win.__TIPTAP_EDITOR__
  }

  console.warn('[PerfBench] 未找到全局编辑器实例，请手动绑定: window.__TIPTAP_EDITOR__ = editor')
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBenchmarkEditor(value: unknown): value is BenchmarkEditor {
  if (!isRecord(value)) return false
  const commands = value.commands
  const view = value.view
  return (
    isRecord(commands) &&
    typeof commands.setContent === 'function' &&
    isRecord(view) &&
    typeof view.updateState === 'function' &&
    isRecord(value.schema) &&
    isRecord(value.state)
  )
}

function callNoArg(value: unknown, methodName: string): unknown {
  if (!isRecord(value)) return null
  const method = value[methodName]
  return typeof method === 'function' ? method() : null
}

function callWithArgs(value: unknown, methodName: string, ...args: unknown[]): unknown {
  if (!isRecord(value)) return null
  const method = value[methodName]
  return typeof method === 'function' ? method(...args) : null
}

function readWindowRecord(): Record<string, unknown> | null {
  return typeof window === 'undefined' ? null : (window as unknown as Record<string, unknown>)
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNestedValue(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (!isRecord(current)) return null
    current = current[key]
  }
  return current
}

function readNestedNumber(value: unknown, path: readonly string[]): number | null {
  return readNumber(readNestedValue(value, path))
}

function readNestedBoolean(value: unknown, path: readonly string[]): boolean | null {
  return readBoolean(readNestedValue(value, path))
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  return readString(readNestedValue(value, path))
}

function formatCheckpointValue(value: string | number | boolean | null): string {
  if (value === null) return '-'
  return String(value)
}

function collectScrollRootSnapshot(): ManualBenchmarkProbeSnapshot['scroll'] {
  try {
    const scrollRoot = findEditorScrollRoot()
    const scrollHeight = Math.round(scrollRoot.scrollHeight)
    const clientHeight = Math.round(scrollRoot.clientHeight)
    return {
      scrollTop: Math.round(scrollRoot.scrollTop),
      scrollHeight,
      clientHeight,
      maxScrollTop: Math.max(0, scrollHeight - clientHeight),
    }
  } catch {
    return {
      scrollTop: null,
      scrollHeight: null,
      clientHeight: null,
      maxScrollTop: null,
    }
  }
}

function readCurrentBenchmarkRootBlockCount(): number | null {
  const win = readWindowRecord()
  const virtualizationDiag = callNoArg(win?.__EDITOR_VIRTUALIZATION_DIAG__, 'snapshot')
  const virtualizationBlockCount = readNestedNumber(virtualizationDiag, ['docRootBlockCount'])
  if (virtualizationBlockCount !== null) return virtualizationBlockCount

  const openPerf = callNoArg(win?.__EDITOR_OPEN_PERF__, 'getCurrent')
  return readNestedNumber(openPerf, ['docInfo', 'rootBlockCount'])
}

function resolveBenchmarkDirectStateLoad(
  content: JSONContent,
  loadMode: BenchmarkLoadMode
): boolean {
  if (loadMode === 'direct-state') return true
  if (loadMode === 'command') return false
  return shouldUseDirectStateDocumentLoad(content)
}

function prepareBenchmarkVirtualizationRuntime(
  editor: BenchmarkEditor,
  rootBlockCount: number,
  loadMode: BenchmarkLoadMode,
  debugRenderVirtualization: boolean
): boolean {
  const shouldUseLargeDocumentShell =
    loadMode !== 'command' &&
    getFlag('autoRootBlockShellForLargeDocuments') &&
    rootBlockCount >= LARGE_DOCUMENT_ROOT_BLOCK_THRESHOLD
  setLargeDocumentShellModeForOwner(editor, shouldUseLargeDocumentShell)

  const virtualRenderDecision = shouldEnableVirtualRootBlockRendering({
    flagEnabled: getFlag('virtualRootBlockRendering'),
    rootBlockCount,
  })
  const enableVirtualRootBlockRendering =
    loadMode !== 'command' && virtualRenderDecision.enabled
  setVirtualRootBlockRenderingActiveForOwner(editor, enableVirtualRootBlockRendering)
  setFlag(
    'renderVirtualizationDebugLogging',
    enableVirtualRootBlockRendering && debugRenderVirtualization
  )
  resetRenderVirtualizationBlockHeightCache(editor)

  return enableVirtualRootBlockRendering
}

type BenchmarkEventListener = () => void

function isBenchmarkEventListener(value: unknown): value is BenchmarkEventListener {
  return typeof value === 'function'
}

function readFileContentLoadedListeners(editor: BenchmarkEditor): BenchmarkEventListener[] | null {
  const listeners = editor.eventBus?.listeners?.['file-content-loaded']
  if (!Array.isArray(listeners)) return null

  const result: BenchmarkEventListener[] = []
  for (const listener of listeners) {
    if (isBenchmarkEventListener(listener)) {
      result.push(listener)
    }
  }
  return result
}

function readListenerName(listener: () => void, index: number): string {
  return listener.name || `anonymous-${index + 1}`
}

function emitBenchmarkFileContentLoadedSync(
  editor: BenchmarkEditor,
  options: BenchmarkOptions
): void {
  const startedAt = performance.now()
  const skippedNames = new Set(options.skipFileContentLoadedListenerNames ?? [])
  const listeners = readFileContentLoadedListeners(editor)
  const shouldTraceListeners = options.traceFileContentLoadedListeners || skippedNames.size > 0
  if (shouldTraceListeners) {
    console.info('[PerfBench] emit file-content-loaded:start', {
      mode: options.postLoadEventMode,
      listenerCount: listeners?.length ?? null,
      listenerNames: listeners?.map((listener, index) => readListenerName(listener, index)) ?? null,
      skipped: [...skippedNames],
    })
  } else {
    console.info('[PerfBench] emit file-content-loaded:start')
  }
  try {
    if (shouldTraceListeners && listeners) {
      listeners.forEach((listener, index) => {
        const listenerName = readListenerName(listener, index)
        if (skippedNames.has(listenerName)) {
          console.info('[PerfBench] file-content-loaded listener skipped', {
            index,
            listenerName,
          })
          return
        }

        const listenerStartedAt = performance.now()
        listener()
        console.info('[PerfBench] file-content-loaded listener completed', {
          index,
          listenerName,
          durationMs: roundMs(performance.now() - listenerStartedAt),
        })
      })
    } else {
      editor.eventBus?.emit?.('file-content-loaded')
    }
    console.info('[PerfBench] emit file-content-loaded:end', {
      durationMs: roundMs(performance.now() - startedAt),
    })
  } catch (error) {
    console.warn('[PerfBench] 触发 file-content-loaded 事件失败：', error)
  }
}

function emitBenchmarkFileContentLoaded(editor: BenchmarkEditor, options: BenchmarkOptions): void {
  if (options.postLoadEventMode === 'skip') {
    console.info('[PerfBench] emit file-content-loaded:skipped')
    return
  }

  if (options.postLoadEventMode === 'timeout') {
    console.info('[PerfBench] emit file-content-loaded:scheduled-timeout')
    window.setTimeout(() => emitBenchmarkFileContentLoadedSync(editor, options), 0)
    return
  }

  if (options.postLoadEventMode === 'raf') {
    console.info('[PerfBench] emit file-content-loaded:scheduled-raf')
    window.requestAnimationFrame(() => emitBenchmarkFileContentLoadedSync(editor, options))
    return
  }

  emitBenchmarkFileContentLoadedSync(editor, options)
}

function logAutomatedOpenCheckpoint(
  label: string,
  phase: string,
  extra: Record<string, unknown> = {}
): void {
  const snapshot = collectManualProbeSnapshot()
  const parts = [
    `label=${label}`,
    `phase=${phase}`,
    `settleMs=${formatCheckpointValue(readNumber(extra.settleMs))}`,
    `virt=${formatCheckpointValue(readNestedBoolean(snapshot.virtualizationDiag, ['virtualizationEnabled']))}`,
    `docBlocks=${formatCheckpointValue(readNestedNumber(snapshot.virtualizationDiag, ['docRootBlockCount']))}`,
    `dom=${formatCheckpointValue(readNestedNumber(snapshot.virtualizationDiag, ['dom', 'rootBlockDomCount']))}`,
    `placeholder=${formatCheckpointValue(readNestedNumber(snapshot.virtualizationDiag, ['dom', 'placeholderDomCount']))}`,
    `hydratedDom=${formatCheckpointValue(readNestedNumber(snapshot.virtualizationDiag, ['dom', 'hydratedDomCount']))}`,
    `hydratedSet=${formatCheckpointValue(readNestedNumber(snapshot.virtualizationDiag, ['hydratedSetCount']))}`,
    `rvReason=${formatCheckpointValue(readNestedString(snapshot.renderVirtualization, ['reason']))}`,
    `rvHydrated=${formatCheckpointValue(readNestedNumber(snapshot.renderVirtualization, ['hydratedCount']))}`,
    `rvReqHydrate=${formatCheckpointValue(readNestedNumber(snapshot.renderVirtualization, ['requestedHydrateCount']))}`,
    `rvReqDehydrate=${formatCheckpointValue(readNestedNumber(snapshot.renderVirtualization, ['requestedDehydrateCount']))}`,
    `nodeViews=${formatCheckpointValue(readNestedNumber(snapshot.nodeView, ['activeTotal']))}`,
    `vueNodeViews=${formatCheckpointValue(readNestedNumber(snapshot.nodeView, ['activeByKind', 'vue']))}`,
    `placeholderNodeViews=${formatCheckpointValue(readNestedNumber(snapshot.nodeView, ['activeByKind', 'placeholder']))}`,
    `chromeLifecycle=${formatCheckpointValue(snapshot.blockChrome.lifecycleActiveCount)}`,
    `chromeActive=${formatCheckpointValue(readNestedNumber(snapshot.blockChrome.activation, ['activeCount']))}`,
    `listeners=${formatCheckpointValue(readNestedNumber(snapshot.blockChrome.editorListeners, ['total']))}`,
    `openMethod=${formatCheckpointValue(readNestedString(snapshot.openPerf, ['setContentStats', 'method']))}`,
    `setContentMs=${formatCheckpointValue(readNestedNumber(snapshot.openPerf, ['timings', 'setContentMs']))}`,
    `viewUpdateMs=${formatCheckpointValue(readNestedNumber(snapshot.openPerf, ['timings', 'setContentViewUpdateMs']))}`,
    `nonViewMs=${formatCheckpointValue(readNestedNumber(snapshot.openPerf, ['timings', 'setContentNonViewUpdateMs']))}`,
  ]
  console.info(`[PerfBenchManual] open checkpoint ${parts.join(' ')}`)
}

function clearTransientInteractionHistories(): void {
  const win = readWindowRecord()
  if (!win) return

  // 中文说明：这里不能清 BlockChrome / NodeView 的 lifecycle 探针，
  // 它们的 clear 会清掉当前 active 集合，导致快照失真。只清不持有状态的交互历史。
  callNoArg(win.__RENDER_VIRT_ENGINE_PERF__, 'clear')
  callNoArg(win.__RENDER_VIRT_VIEWPORT_PERF__, 'clear')
  callNoArg(win.__DECORATION_SET_PERF__, 'clear')
  callNoArg(win.__EDITOR_DRAG_PERF__, 'clear')
  callNoArg(win.__EDITOR_DRAG_ACTION_PERF__, 'clear')
  callNoArg(win.__BLOCK_ACTION_MENU_PERF__, 'clear')
  callNoArg(win.__ANNOTATION_INTERACTION_PERF__, 'clear')
}

function collectManualProbeSnapshot(): ManualBenchmarkProbeSnapshot {
  const win = readWindowRecord()
  const editor = getEditorInstance()
  const heightCacheOwner = isBenchmarkEditor(editor) ? editor : null
  const virtualizationDiag = callNoArg(win?.__EDITOR_VIRTUALIZATION_DIAG__, 'snapshot')
  const blockChromeLifecycle = win?.__BLOCK_CHROME_LIFECYCLE_PERF__
  const decoration = win?.__DECORATION_SET_PERF__
  const dragOver = win?.__EDITOR_DRAG_PERF__
  const dragAction = win?.__EDITOR_DRAG_ACTION_PERF__

  return {
    timestamp: new Date().toISOString(),
    openPerf: callNoArg(win?.__EDITOR_OPEN_PERF__, 'getCurrent'),
    virtualizationDiag,
    renderVirtualization: callNoArg(win?.__RENDER_VIRT_ENGINE_PERF__, 'getLast'),
    viewportTracker: callNoArg(win?.__RENDER_VIRT_VIEWPORT_PERF__, 'getLast'),
    heightCache: heightCacheOwner
      ? getRenderVirtualizationBlockHeightCacheSnapshot(heightCacheOwner)
      : null,
    scroll: collectScrollRootSnapshot(),
    nodeView: callNoArg(win?.__VUE_NODEVIEW_PERF__, 'getSnapshot'),
    blockChrome: {
      lifecycleActiveCount: readNumber(callNoArg(blockChromeLifecycle, 'getActiveCount')),
      lifecycleLast: callNoArg(blockChromeLifecycle, 'getLast'),
      activation: callNoArg(win?.__BLOCK_ACTIVATION_PERF__, 'getSnapshot'),
      editorListeners: callNoArg(win?.__EDITOR_LISTENER_PERF__, 'getSnapshot'),
    },
    decoration: {
      last: callNoArg(decoration, 'getLast'),
      summary: callNoArg(decoration, 'getSummary'),
    },
    drag: {
      lastDragOver: callNoArg(dragOver, 'getLast'),
      lastDragAction: callNoArg(dragAction, 'getLast'),
    },
    memory: {
      renderer: callNoArg(win?.__EDITOR_MEMORY_PERF__, 'getLast'),
      electron: callNoArg(win?.__LINNYA_MEMORY_DIAGNOSTICS__, 'getLatestSample'),
    },
  }
}

function collectManualHistories(): ManualBenchmarkHistories {
  const win = readWindowRecord()
  return {
    renderVirtualization: readArray(callNoArg(win?.__RENDER_VIRT_ENGINE_PERF__, 'getHistory')),
    viewportTracker: readArray(callNoArg(win?.__RENDER_VIRT_VIEWPORT_PERF__, 'getHistory')),
    decoration: readArray(callNoArg(win?.__DECORATION_SET_PERF__, 'getHistory')),
    dragOver: readArray(callNoArg(win?.__EDITOR_DRAG_PERF__, 'getHistory')),
    dragAction: readArray(callNoArg(win?.__EDITOR_DRAG_ACTION_PERF__, 'getHistory')),
    blockChromeLifecycle: readArray(callNoArg(win?.__BLOCK_CHROME_LIFECYCLE_PERF__, 'getHistory')),
    blockActivation: readArray(callNoArg(win?.__BLOCK_ACTIVATION_PERF__, 'getHistory')),
    editorListeners: readArray(callNoArg(win?.__EDITOR_LISTENER_PERF__, 'getHistory')),
    blockActionMenu: readArray(callNoArg(win?.__BLOCK_ACTION_MENU_PERF__, 'getHistory')),
    annotationInteraction: readArray(callNoArg(win?.__ANNOTATION_INTERACTION_PERF__, 'getHistory')),
  }
}

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10
}

function subtractNullableNumbers(after: number | null, before: number | null): number | null {
  if (after === null || before === null) return null
  return after - before
}

function readNestedNumberList(items: readonly unknown[], path: readonly string[]): number[] {
  const values: number[] = []
  for (const item of items) {
    const value = readNestedNumber(item, path)
    if (value !== null) values.push(value)
  }
  return values
}

function summarizeNumberList(values: readonly number[]): ManualBenchmarkNumericSummary {
  if (values.length === 0) {
    return { count: 0, avg: null, max: null, p95: null }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return {
    count: sorted.length,
    avg: roundMs(total / sorted.length),
    max: roundMs(sorted[sorted.length - 1]),
    p95: roundMs(sorted[p95Index]),
  }
}

function countNestedStringValues(
  items: readonly unknown[],
  path: readonly string[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const value = readNestedString(item, path)
    if (value === null) continue
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function readLastNestedNumber(items: readonly unknown[], path: readonly string[]): number | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = readNestedNumber(items[index], path)
    if (value !== null) return value
  }
  return null
}

function readLastNestedString(items: readonly unknown[], path: readonly string[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = readNestedString(items[index], path)
    if (value !== null) return value
  }
  return null
}

export function summarizeManualBenchmarkReport(
  report: ManualBenchmarkReport
): ManualBenchmarkCompactSummary {
  const firstOperation = report.operations[0] ?? null
  const startSnapshot = firstOperation?.startSnapshot ?? report.finalSnapshot
  const endSnapshot = firstOperation?.endSnapshot ?? report.finalSnapshot
  const viewportHistory = report.histories.viewportTracker
  const renderHistory = report.histories.renderVirtualization

  return {
    label: report.label,
    scenario: report.scenario,
    blockCount: report.blockCount,
    durationMs: report.durationMs,
    operationMs: firstOperation?.durationMs ?? null,
    open: {
      method: readNestedString(report.finalSnapshot.openPerf, ['setContentStats', 'method']),
      rootBlocks: readNestedNumber(report.finalSnapshot.openPerf, ['docInfo', 'rootBlockCount']),
      setContentMs: readNestedNumber(report.finalSnapshot.openPerf, ['timings', 'setContentMs']),
      viewUpdateMs: readNestedNumber(report.finalSnapshot.openPerf, ['timings', 'setContentViewUpdateMs']),
      nonViewMs: readNestedNumber(report.finalSnapshot.openPerf, ['timings', 'setContentNonViewUpdateMs']),
    },
    scroll: {
      start: startSnapshot.scroll,
      end: endSnapshot.scroll,
      scrollHeightDelta: subtractNullableNumbers(
        endSnapshot.scroll.scrollHeight,
        startSnapshot.scroll.scrollHeight
      ),
      maxScrollTopDelta: subtractNullableNumbers(
        endSnapshot.scroll.maxScrollTop,
        startSnapshot.scroll.maxScrollTop
      ),
    },
    heightCache: {
      startAdaptiveHeight: readNestedNumber(startSnapshot.heightCache, ['adaptiveElementHeight']),
      endAdaptiveHeight: readNestedNumber(endSnapshot.heightCache, ['adaptiveElementHeight']),
      startMeasuredCount: readNestedNumber(startSnapshot.heightCache, ['measuredCount']),
      endMeasuredCount: readNestedNumber(endSnapshot.heightCache, ['measuredCount']),
    },
    finalDom: {
      rootBlocks: readNestedNumber(report.finalSnapshot.virtualizationDiag, ['dom', 'rootBlockDomCount']),
      hydratedDom: readNestedNumber(report.finalSnapshot.virtualizationDiag, ['dom', 'hydratedDomCount']),
      placeholderDom: readNestedNumber(report.finalSnapshot.virtualizationDiag, ['dom', 'placeholderDomCount']),
    },
    finalNodeView: {
      activeTotal: readNestedNumber(report.finalSnapshot.nodeView, ['activeTotal']),
      vue: readNestedNumber(report.finalSnapshot.nodeView, ['activeByKind', 'vue']),
      placeholder: readNestedNumber(report.finalSnapshot.nodeView, ['activeByKind', 'placeholder']),
    },
    viewportTracker: {
      eventCount: viewportHistory.length,
      decisionCounts: countNestedStringValues(viewportHistory, ['decision']),
      delta: summarizeNumberList(readNestedNumberList(viewportHistory, ['delta'])),
      correctionDelta: summarizeNumberList(readNestedNumberList(viewportHistory, ['correctionDelta'])),
      correctionDistance: summarizeNumberList(
        readNestedNumberList(viewportHistory, ['correctionDistance'])
      ),
      lastDecision: readLastNestedString(viewportHistory, ['decision']),
    },
    renderVirtualization: {
      eventCount: renderHistory.length,
      reasonCounts: countNestedStringValues(renderHistory, ['reason']),
      sourceCounts: countNestedStringValues(renderHistory, ['windowSelectionSource']),
      duration: summarizeNumberList(readNestedNumberList(renderHistory, ['durationMs'])),
      requestedHydrate: summarizeNumberList(readNestedNumberList(renderHistory, ['requestedHydrate'])),
      requestedDehydrate: summarizeNumberList(readNestedNumberList(renderHistory, ['requestedDehydrate'])),
      totalEstimatedHeight: summarizeNumberList(
        readNestedNumberList(renderHistory, ['totalEstimatedHeight'])
      ),
      lastEstimatedHeight: readLastNestedNumber(renderHistory, ['totalEstimatedHeight']),
      lastHydratedCount: readLastNestedNumber(renderHistory, ['hydratedCount']),
    },
  }
}

function summarizeManualProbeSnapshot(snapshot: ManualBenchmarkProbeSnapshot) {
  return {
    timestamp: snapshot.timestamp,
    open: {
      method: readNestedString(snapshot.openPerf, ['setContentStats', 'method']),
      rootBlocks: readNestedNumber(snapshot.openPerf, ['docInfo', 'rootBlockCount']),
      setContentMs: readNestedNumber(snapshot.openPerf, ['timings', 'setContentMs']),
      viewUpdateMs: readNestedNumber(snapshot.openPerf, ['timings', 'setContentViewUpdateMs']),
      nonViewMs: readNestedNumber(snapshot.openPerf, ['timings', 'setContentNonViewUpdateMs']),
    },
    scroll: snapshot.scroll,
    heightCache: {
      adaptiveHeight: readNestedNumber(snapshot.heightCache, ['adaptiveElementHeight']),
      measuredCount: readNestedNumber(snapshot.heightCache, ['measuredCount']),
    },
    dom: {
      rootBlocks: readNestedNumber(snapshot.virtualizationDiag, ['dom', 'rootBlockDomCount']),
      hydratedDom: readNestedNumber(snapshot.virtualizationDiag, ['dom', 'hydratedDomCount']),
      placeholderDom: readNestedNumber(snapshot.virtualizationDiag, ['dom', 'placeholderDomCount']),
    },
    nodeView: {
      activeTotal: readNestedNumber(snapshot.nodeView, ['activeTotal']),
      vue: readNestedNumber(snapshot.nodeView, ['activeByKind', 'vue']),
      placeholder: readNestedNumber(snapshot.nodeView, ['activeByKind', 'placeholder']),
    },
    renderVirtualization: {
      reason: readNestedString(snapshot.renderVirtualization, ['reason']),
      hydratedCount: readNestedNumber(snapshot.renderVirtualization, ['hydratedCount']),
      durationMs: readNestedNumber(snapshot.renderVirtualization, ['durationMs']),
    },
  }
}

function normalizeManualInput(input: ManualBenchmarkSessionInput): Required<ManualBenchmarkSessionInput> {
  return {
    label: input.label.trim() || DEFAULT_MANUAL_INPUT.label,
    scenario: input.scenario ?? DEFAULT_MANUAL_INPUT.scenario,
    blockCount: Math.max(0, Math.floor(input.blockCount ?? DEFAULT_MANUAL_INPUT.blockCount)),
    notes: input.notes?.trim() ?? '',
  }
}

function waitForMs(ms: number, debugLabel?: string): Promise<void> {
  const startedAt = performance.now()
  const logWaitStep = (step: string): void => {
    if (!debugLabel) return
    console.info(
      `[PerfBenchWait] label=${debugLabel} step=${step} elapsedMs=${roundMs(performance.now() - startedAt)}`
    )
  }

  logWaitStep('before-promise')
  return new Promise((resolve) => {
    logWaitStep('executor-start')
    const delayMs = Math.max(0, ms)
    logWaitStep(`before-setTimeout delayMs=${delayMs}`)
    window.setTimeout(() => {
      logWaitStep('timeout-fired')
      resolve()
    }, delayMs)
    logWaitStep('after-setTimeout')
  })
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function getIdleScheduler(): IdleSchedulerGlobal {
  return globalThis as typeof globalThis & IdleSchedulerGlobal
}

function setBenchmarkControl(patch: EditorPerfBenchmarkControl): void {
  if (typeof window === 'undefined') return
  const controlWindow = window as unknown as EditorPerfBenchmarkControlWindow
  if (patch.logBlockViewMountMicrotasks === true) {
    controlWindow.__EDITOR_BLOCK_VIEW_MOUNT_MICROTASK_COUNT__ = 0
  }
  controlWindow.__EDITOR_PERF_BENCH_CONTROL__ = {
    ...controlWindow.__EDITOR_PERF_BENCH_CONTROL__,
    ...patch,
  }
}

function startOpenEventLoopProbe(label: string, phase: string): () => void {
  let active = true
  const startedAt = performance.now()
  const timeoutHandles: number[] = []
  const frameHandles: number[] = []
  let intervalHandle: number | null = null
  let idleHandle: number | null = null

  const elapsed = (): number => roundMs(performance.now() - startedAt)
  const log = (step: string): void => {
    if (!active) return
    console.info(`[PerfBenchProbe] label=${label} phase=${phase} step=${step} elapsedMs=${elapsed()}`)
  }

  log('sync-installed')

  log('before-queueMicrotask')
  queueMicrotask(() => log('microtask'))
  log('after-queueMicrotask')
  log('before-promise-then')
  Promise.resolve().then(() => log('promise-then'))
  log('after-promise-then')

  log('before-timeout-loop')
  ;[0, 16, 50, 250, 1000, 2000].forEach((delayMs) => {
    const handle = window.setTimeout(() => {
      log(`timeout-${delayMs}`)
    }, delayMs)
    timeoutHandles.push(handle)
  })
  log('after-timeout-loop')

  log('before-raf-schedule')
  const firstFrameHandle = window.requestAnimationFrame(() => {
    log('raf-1-start')
    const secondFrameHandle = window.requestAnimationFrame(() => {
      log('raf-2')
    })
    frameHandles.push(secondFrameHandle)
    log('raf-1-end')
  })
  frameHandles.push(firstFrameHandle)
  log('after-raf-schedule')

  log('before-idle-schedule')
  const idleScheduler = getIdleScheduler()
  if (typeof idleScheduler.requestIdleCallback === 'function') {
    idleHandle = idleScheduler.requestIdleCallback((deadline) => {
      log(`idle didTimeout=${deadline.didTimeout} remaining=${roundMs(deadline.timeRemaining())}`)
    }, { timeout: 1200 })
  }
  log('after-idle-schedule')

  let heartbeatCount = 0
  log('before-interval-schedule')
  intervalHandle = window.setInterval(() => {
    heartbeatCount += 1
    log(`heartbeat-${heartbeatCount}`)
    if (heartbeatCount >= 8 && intervalHandle !== null) {
      window.clearInterval(intervalHandle)
      intervalHandle = null
    }
  }, 250)
  log('after-interval-schedule')

  return () => {
    log('cleanup-start')
    active = false
    timeoutHandles.forEach((handle) => window.clearTimeout(handle))
    frameHandles.forEach((handle) => window.cancelAnimationFrame(handle))
    if (intervalHandle !== null) window.clearInterval(intervalHandle)
    if (idleHandle !== null) getIdleScheduler().cancelIdleCallback?.(idleHandle)
  }
}

function readPositiveNumberOption(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function findEditorScrollRoot(): HTMLElement {
  const selectors = [
    '[data-editor-scroll-root="true"]',
    '.editor-shell',
    '.editor-scroll-root',
  ]

  for (const selector of selectors) {
    const el = document.querySelector(selector)
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight) {
      return el
    }
  }

  const proseMirrorEl = document.querySelector('.ProseMirror')
  const closestShell = proseMirrorEl?.closest('.editor-shell')
  if (closestShell instanceof HTMLElement && closestShell.scrollHeight > closestShell.clientHeight) {
    return closestShell
  }

  if (document.scrollingElement instanceof HTMLElement) {
    return document.scrollingElement
  }

  throw new Error('未找到可滚动的编辑器容器，请确认编辑器页面已打开')
}

function resetEditorScrollRootForOpenBenchmark(label: string): void {
  const scrollRoot = findEditorScrollRoot()
  const beforeScrollTop = Math.round(scrollRoot.scrollTop)
  scrollRoot.scrollTop = 0
  scrollRoot.dispatchEvent(new Event('scroll', { bubbles: true }))
  console.info(
    `[PerfBenchManual] open reset-scroll label=${label} before=${beforeScrollTop} after=${Math.round(scrollRoot.scrollTop)} scrollHeight=${Math.round(scrollRoot.scrollHeight)} clientHeight=${Math.round(scrollRoot.clientHeight)}`
  )
}

function makeAutomatedScrollLabel(
  options: AutomatedScrollBenchmarkOptions,
  blockCount: number | undefined
): string {
  if (options.label?.trim()) return options.label.trim()
  return blockCount ? `${blockCount}-scroll-auto-run-1` : 'scroll-auto-run-1'
}

function findFirstHydratedRootBlock(): HTMLElement {
  const hydratedSelectors = [
    '.root-block-outer[data-id][data-root-block-render-mode="hydrated"]',
    '.root-block-outer[data-id].is-hydrated',
    '.root-block-outer[data-id]:not(.root-block-virtual-placeholder)',
  ]

  for (const selector of hydratedSelectors) {
    const el = document.querySelector(selector)
    if (el instanceof HTMLElement) return el
  }

  throw new Error('未找到已 hydrated 的 rootBlock，请先生成文档并等待页面稳定')
}

function resetBenchmarkAnnotations(editor: unknown): void {
  if (!isRecord(editor)) return
  const annotationStore = editor.annotationStore
  const result = callWithArgs(annotationStore, 'loadAnnotations', [])
  if (result !== null) {
    console.info('[PerfBench] 已清空当前 annotationStore，保证压测批注基线干净')
  }
}

async function dispatchRootBlockHover(rootBlock: HTMLElement): Promise<void> {
  rootBlock.scrollIntoView({ block: 'center', inline: 'nearest' })
  await waitForNextFrame()
  rootBlock.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
  rootBlock.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await waitForNextFrame()
}

async function findElementInsideRootBlock(
  rootBlock: HTMLElement,
  selector: string,
  timeoutMs: number
): Promise<HTMLElement> {
  const startedAt = performance.now()
  while (performance.now() - startedAt <= timeoutMs) {
    const el = rootBlock.querySelector(selector)
    if (el instanceof HTMLElement) return el
    await waitForNextFrame()
  }
  throw new Error(`未找到目标元素: ${selector}`)
}

async function clickElement(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect()
  const clientX = rect.left + Math.max(1, rect.width / 2)
  const clientY = rect.top + Math.max(1, rect.height / 2)
  element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  }))
  element.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  }))
  element.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  }))
  element.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  }))
  await waitForNextFrame()
}

export function startManualBenchmarkSession(
  input: ManualBenchmarkSessionInput
): ManualBenchmarkProbeSnapshot {
  const normalized = normalizeManualInput(input)
  clearTransientInteractionHistories()

  const startSnapshot = collectManualProbeSnapshot()
  currentManualSession = {
    input: normalized,
    startedAt: performance.now(),
    startSnapshot,
    operations: [],
    activeOperation: null,
  }

  console.info('[PerfBenchManual] session started', {
    ...normalized,
    snapshot: summarizeManualProbeSnapshot(startSnapshot),
  })
  return startSnapshot
}

export function startManualBenchmarkOperation(label: string): ManualBenchmarkProbeSnapshot {
  if (!currentManualSession) {
    throw new Error('请先调用 window.__EDITOR_PERF_BENCH__.manual.start(...)')
  }
  if (currentManualSession.activeOperation) {
    throw new Error(`上一个操作还未结束: ${currentManualSession.activeOperation.label}`)
  }

  const startSnapshot = collectManualProbeSnapshot()
  currentManualSession.activeOperation = {
    label: label.trim() || 'operation',
    startedAt: performance.now(),
    startSnapshot,
  }
  console.info('[PerfBenchManual] operation started', {
    label,
    snapshot: summarizeManualProbeSnapshot(startSnapshot),
  })
  return startSnapshot
}

export function endManualBenchmarkOperation(): ManualBenchmarkOperation {
  if (!currentManualSession?.activeOperation) {
    throw new Error('没有正在记录的操作，请先调用 manual.startOp(label)')
  }

  const activeOperation = currentManualSession.activeOperation
  const endedAt = performance.now()
  const operation: ManualBenchmarkOperation = {
    label: activeOperation.label,
    startedAt: activeOperation.startedAt,
    endedAt,
    durationMs: roundMs(endedAt - activeOperation.startedAt),
    startSnapshot: activeOperation.startSnapshot,
    endSnapshot: collectManualProbeSnapshot(),
  }

  currentManualSession.operations.push(operation)
  currentManualSession.activeOperation = null
  console.info('[PerfBenchManual] operation ended', {
    label: operation.label,
    durationMs: operation.durationMs,
    start: summarizeManualProbeSnapshot(operation.startSnapshot),
    end: summarizeManualProbeSnapshot(operation.endSnapshot),
  })
  return operation
}

export function finishManualBenchmarkSession(): ManualBenchmarkReport {
  if (!currentManualSession) {
    throw new Error('没有正在记录的 session，请先调用 manual.start(...)')
  }
  if (currentManualSession.activeOperation) {
    endManualBenchmarkOperation()
  }

  const endedAt = performance.now()
  const report: ManualBenchmarkReport = {
    label: currentManualSession.input.label,
    scenario: currentManualSession.input.scenario,
    blockCount: currentManualSession.input.blockCount || null,
    notes: currentManualSession.input.notes,
    startedAt: currentManualSession.startSnapshot.timestamp,
    endedAt: new Date().toISOString(),
    durationMs: roundMs(endedAt - currentManualSession.startedAt),
    operations: currentManualSession.operations,
    finalSnapshot: collectManualProbeSnapshot(),
    histories: collectManualHistories(),
  }

  currentManualSession = null
  console.log('[PerfBenchManual] final report summary', summarizeManualBenchmarkReport(report))
  return report
}

export function copyManualBenchmarkReport(report: ManualBenchmarkReport): string {
  const text = JSON.stringify(report, null, 2)
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch((error: unknown) => {
      console.warn('[PerfBenchManual] clipboard copy failed; use returned string manually', error)
    })
  }
  return text
}

export function copyManualBenchmarkSummary(report: ManualBenchmarkReport): string {
  const text = JSON.stringify(summarizeManualBenchmarkReport(report), null, 2)
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch((error: unknown) => {
      console.warn('[PerfBenchManual] summary clipboard copy failed; use returned string manually', error)
    })
  }
  return text
}

export function getCurrentManualBenchmarkSnapshot(): ManualBenchmarkProbeSnapshot {
  return collectManualProbeSnapshot()
}

export async function runAutomatedScrollBenchmark(
  options: AutomatedScrollBenchmarkOptions = {}
): Promise<ManualBenchmarkReport> {
  const blockCount = options.blockCount
  const label = makeAutomatedScrollLabel(options, blockCount)
  const shouldPrepareDocument = blockCount !== undefined && options.prepareDocument !== false
  if (shouldPrepareDocument) {
    const initialScrollRoot = findEditorScrollRoot()
    const currentMaxScrollTop = Math.max(0, initialScrollRoot.scrollHeight - initialScrollRoot.clientHeight)
    const currentBlockCount = readCurrentBenchmarkRootBlockCount()
    const needsDocumentPrepare = currentBlockCount !== blockCount || currentMaxScrollTop <= 0
    if (needsDocumentPrepare) {
      const openSettleMs = readPositiveNumberOption(options.openSettleMs) ?? DEFAULT_AUTO_OPEN_SETTLE_MS
      console.info('[PerfBenchManual] autoScroll preparing document before scroll', {
        label,
        blockCount,
        currentBlockCount,
        currentMaxScrollTop: Math.round(currentMaxScrollTop),
        openSettleMs,
      })
      resetEditorScrollRootForOpenBenchmark(label)
      await waitForNextFrame()
      runBenchmark(blockCount, options.benchmarkOptions)
      await waitForMs(openSettleMs)
      await waitForNextFrame()
    }
  }

  const scrollRoot = findEditorScrollRoot()
  const direction = options.direction ?? 'down'
  const maxScrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
  const targetScrollTop = direction === 'down' ? maxScrollTop : 0
  const startScrollTop = direction === 'down' ? 0 : maxScrollTop
  const stepPx = readPositiveNumberOption(options.stepPx)
    ?? Math.max(1200, Math.floor(scrollRoot.clientHeight * 1.5))
  const frameDelayMs = readPositiveNumberOption(options.frameDelayMs) ?? 0
  const settleMs = readPositiveNumberOption(options.settleMs) ?? DEFAULT_AUTO_SCROLL_SETTLE_MS
  const maxDurationMs = readPositiveNumberOption(options.maxDurationMs)
    ?? DEFAULT_AUTO_SCROLL_MAX_DURATION_MS
  const operationLabel = direction === 'down'
    ? 'auto-scroll-top-to-bottom'
    : 'auto-scroll-bottom-to-top'
  const notes = options.notes?.trim()
    || `自动滚动；stepPx=${stepPx}；maxScrollTop=${Math.round(maxScrollTop)}`

  scrollRoot.scrollTop = startScrollTop
  scrollRoot.dispatchEvent(new Event('scroll', { bubbles: true }))
  await waitForNextFrame()

  startManualBenchmarkSession({
    label,
    blockCount,
    scenario: 'scroll',
    notes,
  })
  startManualBenchmarkOperation(operationLabel)

  const startedAt = performance.now()
  let currentScrollTop = startScrollTop
  let currentTargetScrollTop = targetScrollTop
  let stalledFrameCount = 0

  while (true) {
    const currentMaxScrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
    currentTargetScrollTop = direction === 'down' ? currentMaxScrollTop : 0
    currentScrollTop = scrollRoot.scrollTop
    if (Math.abs(currentScrollTop - currentTargetScrollTop) <= 1) {
      break
    }

    const elapsedMs = performance.now() - startedAt
    if (elapsedMs > maxDurationMs) {
      console.warn('[PerfBenchManual] autoScroll reached maxDurationMs before target', {
        elapsedMs: roundMs(elapsedMs),
        currentScrollTop: Math.round(currentScrollTop),
        targetScrollTop: Math.round(currentTargetScrollTop),
        maxDurationMs,
      })
      break
    }

    const delta = direction === 'down' ? stepPx : -stepPx
    const nextScrollTop = direction === 'down'
      ? Math.min(currentTargetScrollTop, currentScrollTop + delta)
      : Math.max(currentTargetScrollTop, currentScrollTop + delta)

    const beforeScrollTop = scrollRoot.scrollTop
    scrollRoot.scrollTop = nextScrollTop
    scrollRoot.dispatchEvent(new Event('scroll', { bubbles: true }))

    await waitForNextFrame()
    currentScrollTop = scrollRoot.scrollTop
    const refreshedMaxScrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
    currentTargetScrollTop = direction === 'down' ? refreshedMaxScrollTop : 0
    const movedPx = Math.abs(currentScrollTop - beforeScrollTop)
    if (movedPx <= 1 && Math.abs(currentScrollTop - currentTargetScrollTop) > 1) {
      stalledFrameCount += 1
      if (stalledFrameCount >= 3) {
        console.warn('[PerfBenchManual] autoScroll stopped because scrollTop no longer advances', {
          currentScrollTop: Math.round(currentScrollTop),
          targetScrollTop: Math.round(currentTargetScrollTop),
          scrollHeight: Math.round(scrollRoot.scrollHeight),
          clientHeight: Math.round(scrollRoot.clientHeight),
          stepPx,
        })
        break
      }
    } else {
      stalledFrameCount = 0
    }

    if (frameDelayMs > 0) {
      await waitForMs(frameDelayMs)
    }
  }

  await waitForMs(settleMs)
  endManualBenchmarkOperation()
  const report = finishManualBenchmarkSession()
  console.info('[PerfBenchManual] autoScroll completed', {
    label,
    durationMs: report.operations[0]?.durationMs ?? report.durationMs,
    finalScrollTop: Math.round(scrollRoot.scrollTop),
    targetScrollTop: Math.round(currentTargetScrollTop),
    stepPx,
  })
  return report
}

export async function runAutomatedOpenBenchmark(
  options: AutomatedOpenBenchmarkOptions
): Promise<ManualBenchmarkReport> {
  const label = options.label?.trim() || `${options.blockCount}-open-auto-run-1`
  const settleMs = readPositiveNumberOption(options.settleMs) ?? DEFAULT_AUTO_OPEN_SETTLE_MS
  setBenchmarkControl({
    disableInitialBlockChromeMount: options.disableInitialBlockChromeMount === true,
    disableBlockViewPostMountWork: options.disableBlockViewPostMountWork === true,
    logBlockViewMountMicrotasks: options.logBlockViewMountMicrotasks === true,
  })

  resetEditorScrollRootForOpenBenchmark(label)
  await waitForNextFrame()

  startManualBenchmarkSession({
    label,
    blockCount: options.blockCount,
    scenario: 'open',
    notes: options.notes?.trim() || `自动注入 ${options.blockCount} rootBlock；settleMs=${settleMs}`,
  })
  startManualBenchmarkOperation('auto-open-and-set-content')
  logAutomatedOpenCheckpoint(label, 'before-runBenchmark', { settleMs })
  runBenchmark(options.blockCount, options.benchmarkOptions)
  logAutomatedOpenCheckpoint(label, 'after-runBenchmark-before-settle', { settleMs })
  const debugEventLoopProbe = options.debugEventLoopProbe === true
  let stopEventLoopProbe: (() => void) | null = null
  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] open runner label=${label} step=before-start-probe`)
    stopEventLoopProbe = startOpenEventLoopProbe(label, 'after-runBenchmark-before-settle')
    console.info(`[PerfBenchManual] open runner label=${label} step=after-start-probe`)
  }
  let settled = false
  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] open runner label=${label} step=before-watchdog-setTimeout`)
  }
  const watchdogId = window.setTimeout(() => {
    if (settled) return
    logAutomatedOpenCheckpoint(label, 'settle-watchdog', { settleMs })
  }, Math.max(1000, settleMs * 2))
  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] open runner label=${label} step=after-watchdog-setTimeout`)
    console.info(`[PerfBenchManual] open runner label=${label} step=before-waitForMs`)
  }
  const settlePromise = waitForMs(settleMs, debugEventLoopProbe ? `${label}:open-settle` : undefined)
  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] open runner label=${label} step=after-waitForMs-call-before-await`)
  }
  await settlePromise
  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] open runner label=${label} step=after-waitForMs`)
  }
  settled = true
  setBenchmarkControl({
    disableInitialBlockChromeMount: false,
    disableBlockViewPostMountWork: false,
    logBlockViewMountMicrotasks: false,
  })
  stopEventLoopProbe?.()
  window.clearTimeout(watchdogId)
  logAutomatedOpenCheckpoint(label, 'after-settle-before-endOp', { settleMs })
  endManualBenchmarkOperation()
  logAutomatedOpenCheckpoint(label, 'after-endOp-before-finish', { settleMs })
  return finishManualBenchmarkSession()
}

export function runDetachedOpenBenchmark(
  options: AutomatedOpenBenchmarkOptions
): DetachedOpenBenchmarkHandle {
  const label = options.label?.trim() || `${options.blockCount}-open-detached-run-1`
  const settleMs = readPositiveNumberOption(options.settleMs) ?? DEFAULT_AUTO_OPEN_SETTLE_MS
  lastDetachedOpenReport = null
  setBenchmarkControl({
    disableInitialBlockChromeMount: options.disableInitialBlockChromeMount === true,
    disableBlockViewPostMountWork: options.disableBlockViewPostMountWork === true,
    logBlockViewMountMicrotasks: options.logBlockViewMountMicrotasks === true,
  })

  resetEditorScrollRootForOpenBenchmark(label)
  startManualBenchmarkSession({
    label,
    blockCount: options.blockCount,
    scenario: 'open',
    notes: options.notes?.trim()
      || `无 await 注入 ${options.blockCount} rootBlock；settleMs=${settleMs}`,
  })
  startManualBenchmarkOperation('detached-open-and-set-content')
  logAutomatedOpenCheckpoint(label, 'detached-before-runBenchmark', { settleMs })
  runBenchmark(options.blockCount, options.benchmarkOptions)
  logAutomatedOpenCheckpoint(label, 'detached-after-runBenchmark-before-settle', { settleMs })

  const debugEventLoopProbe = options.debugEventLoopProbe === true
  let stopEventLoopProbe: (() => void) | null = null
  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] detached open label=${label} step=before-start-probe`)
    stopEventLoopProbe = startOpenEventLoopProbe(label, 'detached-after-runBenchmark-before-settle')
    console.info(`[PerfBenchManual] detached open label=${label} step=after-start-probe`)
  }

  let settled = false
  const watchdogId = window.setTimeout(() => {
    if (settled) return
    logAutomatedOpenCheckpoint(label, 'detached-settle-watchdog', { settleMs })
  }, Math.max(1000, settleMs * 2))

  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] detached open label=${label} step=before-settle-setTimeout`)
  }
  window.setTimeout(() => {
    if (debugEventLoopProbe) {
      console.info(`[PerfBenchManual] detached open label=${label} step=settle-timeout-fired`)
    }
    settled = true
    setBenchmarkControl({
      disableInitialBlockChromeMount: false,
      disableBlockViewPostMountWork: false,
      logBlockViewMountMicrotasks: false,
    })
    stopEventLoopProbe?.()
    window.clearTimeout(watchdogId)
    logAutomatedOpenCheckpoint(label, 'detached-after-settle-before-endOp', { settleMs })
    endManualBenchmarkOperation()
    logAutomatedOpenCheckpoint(label, 'detached-after-endOp-before-finish', { settleMs })
    lastDetachedOpenReport = finishManualBenchmarkSession()
  }, settleMs)
  if (debugEventLoopProbe) {
    console.info(`[PerfBenchManual] detached open label=${label} step=after-settle-setTimeout`)
  }

  return {
    label,
    blockCount: options.blockCount,
    settleMs,
    status: 'scheduled',
    readReport: () => lastDetachedOpenReport,
  }
}

export function getLastDetachedOpenBenchmarkReport(): ManualBenchmarkReport | null {
  return lastDetachedOpenReport
}

export async function runAutomatedMenuBenchmark(
  options: AutomatedMenuBenchmarkOptions = {}
): Promise<ManualBenchmarkReport> {
  const blockCount = options.blockCount
  const label = options.label?.trim()
    || (blockCount ? `${blockCount}-menu-auto-run-1` : 'menu-auto-run-1')
  const settleMs = readPositiveNumberOption(options.settleMs) ?? DEFAULT_AUTO_MENU_SETTLE_MS
  const rootBlock = findFirstHydratedRootBlock()

  await dispatchRootBlockHover(rootBlock)
  const dragHandle = await findElementInsideRootBlock(
    rootBlock,
    '[data-drag-handle="true"]',
    1000
  )

  startManualBenchmarkSession({
    label,
    blockCount,
    scenario: 'custom',
    notes: options.notes?.trim() || '自动打开块操作菜单；非破坏性',
  })
  startManualBenchmarkOperation('auto-open-block-action-menu')

  dragHandle.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 2,
    clientX: dragHandle.getBoundingClientRect().left,
    clientY: dragHandle.getBoundingClientRect().top,
  }))

  await waitForMs(settleMs)
  endManualBenchmarkOperation()
  const report = finishManualBenchmarkSession()

  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await waitForNextFrame()

  return report
}

export async function runAutomatedAnnotationBenchmark(
  options: AutomatedAnnotationBenchmarkOptions = {}
): Promise<ManualBenchmarkReport> {
  const blockCount = options.blockCount
  const label = options.label?.trim()
    || (blockCount ? `${blockCount}-annotation-auto-run-1` : 'annotation-auto-run-1')
  const settleMs = readPositiveNumberOption(options.settleMs) ?? DEFAULT_AUTO_ANNOTATION_SETTLE_MS
  const rootBlock = findFirstHydratedRootBlock()

  await dispatchRootBlockHover(rootBlock)
  const annotationHandle = await findElementInsideRootBlock(
    rootBlock,
    '[data-annotation-handle="true"]',
    1000
  )

  startManualBenchmarkSession({
    label,
    blockCount,
    scenario: 'custom',
    notes: options.notes?.trim()
      || '自动点击批注按钮；激进压测，会写入 annotationStore 并可能触发持久化',
  })
  startManualBenchmarkOperation('auto-create-annotation')

  await clickElement(annotationHandle)
  await waitForMs(settleMs)

  endManualBenchmarkOperation()
  return finishManualBenchmarkSession()
}

export async function runAutomatedScaleSuite(
  options: AutomatedScaleSuiteOptions = {}
): Promise<ManualBenchmarkReport[]> {
  const blockCounts = options.blockCounts?.length
    ? options.blockCounts.map((count) => Math.max(1, Math.floor(count)))
    : DEFAULT_SCALE_SUITE_BLOCK_COUNTS
  const scenarios = options.scenarios?.length ? options.scenarios : ['open', 'menu', 'scroll']
  const reports: ManualBenchmarkReport[] = []
  const settleMs = readPositiveNumberOption(options.settleMs) ?? DEFAULT_AUTO_OPEN_SETTLE_MS

  for (const blockCount of blockCounts) {
    if (scenarios.includes('open')) {
      reports.push(await runAutomatedOpenBenchmark({
        label: `${blockCount}-open-auto-run-1`,
        blockCount,
        settleMs,
        benchmarkOptions: options.benchmarkOptions,
      }))
    } else {
      runBenchmark(blockCount, options.benchmarkOptions)
      await waitForMs(settleMs)
    }

    if (scenarios.includes('menu')) {
      reports.push(await runAutomatedMenuBenchmark({
        label: `${blockCount}-menu-auto-run-1`,
        blockCount,
      }))
    }

    if (scenarios.includes('annotation')) {
      reports.push(await runAutomatedAnnotationBenchmark({
        label: `${blockCount}-annotation-auto-run-1`,
        blockCount,
      }))
    }

    if (scenarios.includes('scroll')) {
      reports.push(await runAutomatedScrollBenchmark({
        label: `${blockCount}-scroll-auto-run-1`,
        blockCount,
        stepPx: options.scrollStepPx,
      }))
    }
  }

  console.info('[PerfBenchManual] scale suite completed', {
    blockCounts,
    scenarios,
    reportCount: reports.length,
  })
  return reports
}

/**
 * 执行压测：生成文档并注入编辑器。
 * editorOpenPerf 会自动采集性能数据并在 finalize 时输出报告。
 */
export function runBenchmark(
  blockCount: number,
  userOptions?: Partial<BenchmarkOptions>
): void {
  const opts = { ...DEFAULT_OPTIONS, ...userOptions }

  console.group(`[PerfBench] 开始压测：${blockCount} 块`)
  console.log('配置:', opts)

  const editor = getEditorInstance()
  if (!isBenchmarkEditor(editor)) {
    console.error('[PerfBench] 无法获取编辑器实例，中止压测')
    console.groupEnd()
    return
  }

  const doc = generateBenchmarkDoc(blockCount, opts)
  const rootBlockCount = countRootBlocksInDocJson(doc)
  const useDirectStateLoad = resolveBenchmarkDirectStateLoad(doc, opts.loadMode)
  const enableVirtualRootBlockRendering = prepareBenchmarkVirtualizationRuntime(
    editor,
    rootBlockCount,
    opts.loadMode,
    opts.debugRenderVirtualization
  )

  console.log(`[PerfBench] 文档已生成：${blockCount} 个 rootBlock`)
  console.log('[PerfBench] 即将注入文档，editorOpenPerf 将自动采集...', {
    loadMode: opts.loadMode,
    useDirectStateLoad,
    enableVirtualRootBlockRendering,
  })

  // editorOpenPerf 的 resetOpenPerf 会在 editorService.loadDocumentFromDatabase 中被调用
  // 但压测直接注入文档时不走 editorService，需要手动重置。
  resetOpenPerf()
  setDocInfo({
    rootBlockCount,
    hasPendingRevisions: opts.revisionRatio > 0,
    pendingRevisionCount: Math.floor(blockCount * Math.min(Math.max(opts.revisionRatio, 0), 1)),
  })

  const t0 = performance.now()

  try {
    if (useDirectStateLoad) {
      loadDocumentJsonViaDirectState(editor, doc, {
        prepareState: (state) => prepareInitialRenderVirtualizationState(state, {
          enabled: enableVirtualRootBlockRendering,
        }),
      })
    } else {
      measureSetContentOperation(editor.view, () => {
        editor.commands.setContent(doc, {
          emitUpdate: false,
          parseOptions: { preserveWhitespace: 'full' },
        })
      })
    }
    resetBenchmarkAnnotations(editor)
    emitBenchmarkFileContentLoaded(editor, opts)
  } catch (err) {
    setVirtualRootBlockRenderingActiveForOwner(editor, false)
    console.error('[PerfBench] 文档注入失败:', err)
    console.groupEnd()
    return
  }

  const t1 = performance.now()
  const rawMs = Math.round(t1 - t0)

  console.log(
    `[PerfBench] ${useDirectStateLoad ? 'direct-state' : 'setContent'} 完成，原始耗时: ${rawMs}ms`
  )

  // 尝试 finalize perf 快照
  finalizeOpenPerf()

  console.groupEnd()
}

/**
 * 对比测试：先用旧的 command/setContent 路径跑一次，再用产品真实 auto 路径跑一次。
 */
export function runComparison(
  blockCount: number,
  userOptions?: Partial<BenchmarkOptions>
): void {
  console.group(`[PerfBench] 对比测试：${blockCount} 块`)

  // 第一轮：旧路径
  console.log('=== 第一轮：旧路径 (loadMode=command) ===')
  runBenchmark(blockCount, { ...userOptions, loadMode: 'command' })

  // 延迟后执行第二轮，避免重叠
  setTimeout(() => {
    console.log('=== 第二轮：产品真实路径 (loadMode=auto) ===')
    runBenchmark(blockCount, { ...userOptions, loadMode: 'auto' })
    console.groupEnd()
  }, 2000)
}

// ==================== DevTools 挂载 ====================

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__EDITOR_PERF_BENCH__ = {
    generateDoc: generateBenchmarkDoc,
    generateRevisions: generateMockRevisions,
    run: runBenchmark,
    runComparison,
    snapshot: getCurrentManualBenchmarkSnapshot,
    auto: {
      open: runAutomatedOpenBenchmark,
      openDetached: runDetachedOpenBenchmark,
      getLastDetachedOpenReport: getLastDetachedOpenBenchmarkReport,
      scroll: runAutomatedScrollBenchmark,
      menu: runAutomatedMenuBenchmark,
      annotation: runAutomatedAnnotationBenchmark,
      scaleSuite: runAutomatedScaleSuite,
    },
    manual: {
      start: startManualBenchmarkSession,
      startOp: startManualBenchmarkOperation,
      endOp: endManualBenchmarkOperation,
      finish: finishManualBenchmarkSession,
      copy: copyManualBenchmarkReport,
      summarize: summarizeManualBenchmarkReport,
      copySummary: copyManualBenchmarkSummary,
      snapshot: getCurrentManualBenchmarkSnapshot,
      autoScroll: runAutomatedScrollBenchmark,
    },
  }
}
