/**
 * @file __devRevisionTest.ts
 * @description 开发调试工具：在控制台注入大量假修订，验证全局统计与页面切换持久化。
 *
 * 使用方式（在 DevTools 控制台）：
 *
 *   // 注入 100 个假修订（块不够会自动创建；写入后端 + 刷新前端）
 *   window.__REVISION_TEST__.inject(100)
 *
 *   // 只在后端准备 10000 条 pending，不立刻投影前端；适合重新打开文档测首开性能
 *   window.__REVISION_TEST__.seed(10000)
 *
 *   // 查看当前 canonical sessions 状态
 *   window.__REVISION_TEST__.dump()
 *
 *   // 诊断当前文档 pending 是否能匹配真实 rootBlock
 *   window.__REVISION_TEST__.diagnose()
 *
 *   // 清除所有修订（后端 + 前端 + 文档 marks 全清）
 *   window.__REVISION_TEST__.clear()
 *
 * 前提：编辑器已加载文档（editorFactory 会自动设置 window.__TIPTAP_EDITOR__）。
 *
 * ⚠️ 仅供开发调试，不要在生产环境使用。
 */

import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  workspaceGateway,
  type PendingRevisionDTO as WorkspacePendingRevisionDTO,
} from '../../../../../shared/ipc/workspaceGateway'
import { useFileStore } from '../../../../../shared/stores/file'
import { useRevisionStore } from './useRevisionStore'
import { scanBlockForRevisions } from './revisionMarkScan'
import { findRootBlockPosById } from '../utils/pending/pendingRevisionHelpers'
import { ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR } from '../ui/shell/shellBlockRevisionHeaderDom'
import {
  collectSampledViewportRootBlocks,
  readRootBlockIdFromElement,
} from '../../../ui/composables/rootBlockViewportSnapshot'
import {
  findSelectionRootBlockId,
  getRenderVirtualizationState,
} from '../../RenderVirtualization/state/renderVirtualizationPlugin'
import { serializeRevisionBaselineForSave } from '../functions/serializeRevisionBaselineForSave'

interface DevEditor extends Editor {
  commands: Editor['commands'] & {
    clearBlockRevisionMarks: (blockPos: number, revisionId?: string | null) => boolean
  }
}

interface BlockSnapshot {
  blockId: string
  text: string
  rootPos: number
  appendTextPos: number | null
}

interface SeedOptions {
  /** 是否写入后立刻投影到当前前端，默认 false */
  applyToFrontend?: boolean
  /** 是否先清空当前文档已有 pending，默认 true */
  clearExisting?: boolean
  /** 每次 IPC 写入多少条 pending，默认 500，避免一次消息过大 */
  chunkSize?: number
}

interface PerfBlockIdSample {
  candidateBlockIds: string[]
  skippedActiveBlockIds: string[]
  skippedNonPendingBlockIds: string[]
}

interface HeaderBlockIdSample {
  renderedBlockIds: string[]
  sessionMissBlockIds: string[]
  slotMissBlockIds: string[]
  outerMissBlockIds: string[]
}

interface EngineBlockIdSample {
  visibleBlockIds: string[]
  hydratedBlockIds: string[]
  missingHydratedBlockIds: string[]
}

type DiagnoseWindowSampleSource =
  | 'explicit'
  | 'current-dom'
  | 'engine-perf'
  | 'projection-perf'
  | 'header-perf'

interface DiagnoseWindowSample {
  blockIds: string[]
  source: DiagnoseWindowSampleSource
}

const VALID_EDITOR_NODE_ID_RE =
  /^(?:[a-z]+-[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

let fallbackIdCounter = 0

function isValidEditorNodeId(id: unknown): id is string {
  return typeof id === 'string' && VALID_EDITOR_NODE_ID_RE.test(id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function readLatestPendingProjectionPerf(): PerfBlockIdSample {
  if (typeof window === 'undefined') {
    return { candidateBlockIds: [], skippedActiveBlockIds: [], skippedNonPendingBlockIds: [] }
  }

  const api = (window as unknown as Record<string, unknown>).__SHELL_PENDING_PROJECTION_PERF__
  if (!isRecord(api) || typeof api.getLast !== 'function') {
    return { candidateBlockIds: [], skippedActiveBlockIds: [], skippedNonPendingBlockIds: [] }
  }

  const sample = api.getLast()
  if (!isRecord(sample)) {
    return { candidateBlockIds: [], skippedActiveBlockIds: [], skippedNonPendingBlockIds: [] }
  }

  return {
    candidateBlockIds: readStringArrayField(sample, 'candidateBlockIds'),
    skippedActiveBlockIds: readStringArrayField(sample, 'skippedActiveBlockIds'),
    skippedNonPendingBlockIds: readStringArrayField(sample, 'skippedNonPendingBlockIds'),
  }
}

function readLatestShellHeaderPerf(): HeaderBlockIdSample {
  if (typeof window === 'undefined') {
    return {
      renderedBlockIds: [],
      sessionMissBlockIds: [],
      slotMissBlockIds: [],
      outerMissBlockIds: [],
    }
  }

  const api = (window as unknown as Record<string, unknown>).__SHELL_REVISION_HEADER_PERF__
  if (!isRecord(api) || typeof api.getLast !== 'function') {
    return {
      renderedBlockIds: [],
      sessionMissBlockIds: [],
      slotMissBlockIds: [],
      outerMissBlockIds: [],
    }
  }

  const sample = api.getLast()
  if (!isRecord(sample)) {
    return {
      renderedBlockIds: [],
      sessionMissBlockIds: [],
      slotMissBlockIds: [],
      outerMissBlockIds: [],
    }
  }

  return {
    renderedBlockIds: readStringArrayField(sample, 'renderedBlockIds'),
    sessionMissBlockIds: readStringArrayField(sample, 'sessionMissBlockIds'),
    slotMissBlockIds: readStringArrayField(sample, 'slotMissBlockIds'),
    outerMissBlockIds: readStringArrayField(sample, 'outerMissBlockIds'),
  }
}

function readLatestRenderVirtualizationPerf(): EngineBlockIdSample {
  if (typeof window === 'undefined') {
    return { visibleBlockIds: [], hydratedBlockIds: [], missingHydratedBlockIds: [] }
  }

  const api = (window as unknown as Record<string, unknown>).__RENDER_VIRT_ENGINE_PERF__
  if (!isRecord(api) || typeof api.getLast !== 'function') {
    return { visibleBlockIds: [], hydratedBlockIds: [], missingHydratedBlockIds: [] }
  }

  const sample = api.getLast()
  if (!isRecord(sample)) {
    return { visibleBlockIds: [], hydratedBlockIds: [], missingHydratedBlockIds: [] }
  }

  return {
    visibleBlockIds: readStringArrayField(sample, 'visibleBlockIds'),
    hydratedBlockIds: readStringArrayField(sample, 'hydratedBlockIds'),
    missingHydratedBlockIds: readStringArrayField(sample, 'missingHydratedBlockIds'),
  }
}

function uniqBlockIds(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function findEditorScrollRoot(editorRoot: HTMLElement): HTMLElement | null {
  const closestShell = editorRoot.closest('.editor-shell')
  if (closestShell instanceof HTMLElement) return closestShell

  const documentShell = document.querySelector('.editor-shell')
  return documentShell instanceof HTMLElement ? documentShell : null
}

/**
 * 开发工具只需要生成临时块 ID，避免依赖 JS 版 idUtils 带来的隐式宽类型。
 * 注意：必须是 `root-xxxxxxxx` / `block-xxxxxxxx`，否则 UniqueIdsExtension 会在打开后重写 ID，
 * 导致 pending 指向旧 ID，形成海量幽灵 pending。
 */
function createDevShortId(usedIds: Set<string>): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    for (let i = 0; i < 100; i++) {
      const candidate = crypto.randomUUID().split('-').join('').slice(0, 8)
      if (!usedIds.has(candidate)) return candidate
    }
  }

  for (let i = 0; i < 0xffffffff; i++) {
    fallbackIdCounter = (fallbackIdCounter + 1) >>> 0
    const candidate = fallbackIdCounter.toString(16).padStart(8, '0')
    if (!usedIds.has(candidate)) return candidate
  }

  throw new Error('[RevisionTest] 无法生成唯一测试块 ID')
}

function generateUniqueDevNodeId(prefix: 'root' | 'block', usedIds: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const id = `${prefix}-${createDevShortId(usedIds)}`
    if (!usedIds.has(id)) {
      usedIds.add(id)
      return id
    }
  }

  throw new Error(`[RevisionTest] 无法生成唯一 ${prefix} ID`)
}

function collectAllNodeIds(editor: Editor): Set<string> {
  const ids = new Set<string>()
  editor.state.doc.descendants(node => {
    const id = node.attrs?.id
    if (typeof id === 'string' && id.length > 0) ids.add(id)
    return true
  })
  return ids
}

function normalizeRootBlockIdsForSeed(editor: Editor): number {
  const usedRootIds = new Set<string>()
  let changedCount = 0
  let pos = 0
  let tr = editor.state.tr

  editor.state.doc.forEach(node => {
    if (node.type.name !== 'rootBlock') {
      pos += node.nodeSize
      return
    }

    const currentId = node.attrs.id
    if (isValidEditorNodeId(currentId) && !usedRootIds.has(currentId)) {
      usedRootIds.add(currentId)
      pos += node.nodeSize
      return
    }

    const nextId = generateUniqueDevNodeId('root', usedRootIds)
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: nextId })
    changedCount += 1
    pos += node.nodeSize
  })

  if (changedCount > 0) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
    console.warn(`[RevisionTest] 已修复 ${changedCount} 个非法/重复 rootBlock ID，再生成 pending`)
  }

  return changedCount
}

function getEditor(): Editor | null {
  const win = window as unknown as Record<string, unknown>
  const editor = win.__TIPTAP_EDITOR__ as Editor | undefined
  if (!editor) {
    console.error('[RevisionTest] 未找到编辑器实例。请确保已打开文档。')
    return null
  }
  return editor
}

function getDocumentId(): string | null {
  const fileStore = useFileStore()
  const docId = fileStore.currentFilePath
  if (!docId) {
    console.error('[RevisionTest] 当前没有活动文档 (currentFilePath 为空)。')
    return null
  }
  return docId
}

/**
 * 从文档中收集所有 rootBlock 的 ID、文本内容与关键位置
 */
function collectBlocks(editor: Editor): BlockSnapshot[] {
  const blocks: BlockSnapshot[] = []
  let pos = 0
  editor.state.doc.forEach(node => {
    if (node.type.name === 'rootBlock' && node.attrs.id) {
      blocks.push({
        blockId: node.attrs.id as string,
        text: node.textContent,
        rootPos: pos,
        appendTextPos: findAppendTextPosition(node, pos),
      })
    }
    pos += node.nodeSize
  })
  return blocks
}

function collectCurrentViewportBlockIds(editor: Editor): string[] {
  const editorRoot = editor.view.dom
  const scrollRoot = findEditorScrollRoot(editorRoot)
  const blocks = collectSampledViewportRootBlocks({
    editorRoot,
    scrollRoot,
    // 中文说明：这是手动诊断命令，不在滚动热路径；采样稍密一点，避免大块文档漏掉当前屏。
    maxItems: 48,
    rowStepPx: 48,
  })

  return uniqBlockIds(
    blocks.flatMap(el => {
      const blockId = readRootBlockIdFromElement(el)
      return blockId ? [blockId] : []
    })
  )
}

/**
 * 找到块内第一个可写 textblock 的尾部位置，用于直接插入测试文本。
 */
function findAppendTextPosition(node: ProseMirrorNode, pos: number): number | null {
  if (node.isTextblock) {
    return pos + node.nodeSize - 1
  }

  let childPos = pos + 1
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    const found = findAppendTextPosition(child, childPos)
    if (found != null) return found
    childPos += child.nodeSize
  }

  return null
}

/**
 * 在文档末尾批量创建 rootBlock > baseBlock > text 节点
 */
function createBlocksInDocument(editor: Editor, count: number): string[] {
  const { schema } = editor.state
  const rootBlockType = schema.nodes.rootBlock
  const baseBlockType = schema.nodes.baseBlock

  if (!rootBlockType || !baseBlockType) {
    console.error('[RevisionTest] schema 中未找到 rootBlock / baseBlock 类型')
    return []
  }

  const createdIds: string[] = []
  const usedIds = collectAllNodeIds(editor)
  let tr = editor.state.tr

  for (let i = 0; i < count; i++) {
    const rootId = generateUniqueDevNodeId('root', usedIds)
    const blockId = generateUniqueDevNodeId('block', usedIds)
    const text = `测试块 #${i + 1} — 用于验证 revision 全局统计的自动生成内容。`

    const baseBlock = baseBlockType.create(
      { id: blockId, blockType: 'baseBlock' },
      schema.text(text)
    )
    const rootBlock = rootBlockType.create({ id: rootId }, [baseBlock])

    tr.insert(tr.doc.content.size, rootBlock)
    createdIds.push(rootId)
  }

  tr.setMeta('addToHistory', false)
  tr.setMeta('pendingRevisionApply', true)
  editor.view.dispatch(tr)

  return createdIds
}

function buildFakeRevisions(blocks: BlockSnapshot[]): Array<{
  blockId: string
  newMarkdown: string
  source: 'ai'
  meta: Record<string, unknown>
}> {
  return blocks.map((block, i) => ({
    blockId: block.blockId,
    newMarkdown: `${block.text || `测试块 #${i + 1}`} [AI修订 #${i + 1}]`,
    source: 'ai' as const,
    meta: { operation: 'update', toolName: '__devRevisionTest' },
  }))
}

async function writePendingRevisionsInChunks(params: {
  documentId: string
  revisions: ReturnType<typeof buildFakeRevisions>
  chunkSize: number
}): Promise<{ writtenCount: number; totalRequested: number; errors: string[] } | null> {
  const { documentId, revisions } = params
  const chunkSize = Math.max(1, params.chunkSize)
  let writtenCount = 0
  const errors: string[] = []

  for (let start = 0; start < revisions.length; start += chunkSize) {
    const chunk = revisions.slice(start, start + chunkSize)
    const batchResult = await workspaceGateway['set-pending-revisions-batch']({
      documentId,
      revisions: chunk,
    })

    if (!batchResult.success) {
      errors.push(`chunk ${start}-${start + chunk.length - 1}: ${batchResult.error}`)
      continue
    }

    writtenCount += batchResult.data.writtenCount
    errors.push(...batchResult.data.errors)
    console.log(
      `[RevisionTest] pending 写入请求进度: ${Math.min(start + chunk.length, revisions.length)}/${revisions.length}, 成功写入: ${writtenCount}/${revisions.length}`
    )
  }

  return {
    writtenCount,
    totalRequested: revisions.length,
    errors,
  }
}

async function persistCurrentEditorContentForSeed(
  editor: Editor,
  documentId: string
): Promise<boolean> {
  const rootBlockCount = collectBlocks(editor).length
  const serializedContent = serializeRevisionBaselineForSave(editor)
  const result = await workspaceGateway['save-document']({
    documentId,
    content: serializedContent,
  })

  if (!result.success) {
    console.error('[RevisionTest] seed 前强制保存当前编辑器内容失败:', result.error)
    return false
  }

  useFileStore().setDirty(false)
  console.log(
    `[RevisionTest] seed 前已强制同步当前编辑器内容到后端: documentId=${documentId}, rootBlocks=${rootBlockCount}`
  )
  return true
}

function assertExactPendingCoverage(params: {
  targetBlocks: BlockSnapshot[]
  pendingDTOs: WorkspacePendingRevisionDTO[]
}): boolean {
  const targetBlockIds = new Set(params.targetBlocks.map(block => block.blockId))
  const pendingBlockIds = new Set(
    params.pendingDTOs
      .map(dto => dto.blockId)
      .filter((blockId): blockId is string => typeof blockId === 'string' && blockId.length > 0)
  )
  const missingBlockIds = params.targetBlocks
    .map(block => block.blockId)
    .filter(blockId => !pendingBlockIds.has(blockId))
  const orphanPendingBlockIds = params.pendingDTOs
    .map(dto => dto.blockId)
    .filter((blockId): blockId is string => typeof blockId === 'string' && blockId.length > 0)
    .filter(blockId => !targetBlockIds.has(blockId))

  if (missingBlockIds.length === 0 && orphanPendingBlockIds.length === 0) {
    return true
  }

  console.error('[RevisionTest] pending 覆盖校验失败：seed 结果不是完整的一块一条 pending', {
    targetCount: params.targetBlocks.length,
    pendingCount: params.pendingDTOs.length,
    missingCount: missingBlockIds.length,
    orphanPendingCount: orphanPendingBlockIds.length,
    missingSamples: missingBlockIds.slice(0, 20),
    orphanSamples: orphanPendingBlockIds.slice(0, 20),
  })
  return false
}

function pickDiagnoseWindowSample(params: {
  explicitBlockIds: string[]
  currentViewportBlockIds: string[]
  pendingPerf: PerfBlockIdSample
  headerPerf: HeaderBlockIdSample
  enginePerf: EngineBlockIdSample
}): DiagnoseWindowSample {
  if (params.explicitBlockIds.length > 0) {
    return {
      blockIds: uniqBlockIds(params.explicitBlockIds),
      source: 'explicit',
    }
  }

  if (params.currentViewportBlockIds.length > 0) {
    return {
      blockIds: params.currentViewportBlockIds,
      source: 'current-dom',
    }
  }

  const engineBlockIds = uniqBlockIds([
    ...params.enginePerf.visibleBlockIds,
    ...params.enginePerf.hydratedBlockIds,
    ...params.enginePerf.missingHydratedBlockIds,
  ])
  if (engineBlockIds.length > 0) {
    return {
      blockIds: engineBlockIds,
      source: 'engine-perf',
    }
  }

  const projectionBlockIds = uniqBlockIds([
    ...params.pendingPerf.candidateBlockIds,
    ...params.pendingPerf.skippedActiveBlockIds,
    ...params.pendingPerf.skippedNonPendingBlockIds,
  ])
  if (projectionBlockIds.length > 0) {
    return {
      blockIds: projectionBlockIds,
      source: 'projection-perf',
    }
  }

  return {
    blockIds: uniqBlockIds([
      ...params.headerPerf.renderedBlockIds,
      ...params.headerPerf.sessionMissBlockIds,
      ...params.headerPerf.slotMissBlockIds,
      ...params.headerPerf.outerMissBlockIds,
    ]),
    source: 'header-perf',
  }
}

function describeCurrentRevisionCategory(params: {
  backendPending: boolean
  canonical: boolean
  activeStatus: string | null
  docMark: string | null
  placeholder: boolean
  headerHidden: boolean | null
}): string {
  if (!params.backendPending && !params.canonical && !params.activeStatus && !params.docMark) {
    return 'no-pending-data'
  }
  if (params.placeholder) return 'pending-placeholder'
  if (params.docMark)
    return params.headerHidden === false ? 'projected-with-header' : 'projected-no-header'
  if (params.activeStatus === 'pending') {
    return params.headerHidden === false ? 'active-with-header' : 'active-no-header'
  }
  if (params.canonical) {
    return params.headerHidden === false ? 'canonical-with-header' : 'canonical-no-header'
  }
  if (params.backendPending) return 'backend-only'
  return 'unknown'
}

async function prepareBackendPending(
  count: number,
  options: SeedOptions = {}
): Promise<{
  documentId: string
  pendingCount: number
  storePendingDTOs?: WorkspacePendingRevisionDTO[]
} | null> {
  const editor = getEditor()
  if (!editor) return null
  const documentId = getDocumentId()
  if (!documentId) return null

  const clearExisting = options.clearExisting !== false
  const chunkSize = options.chunkSize ?? 500

  if (clearExisting) {
    normalizeRootBlockIdsForSeed(editor)
  }

  // 1. 补齐块
  const existingBlocks = collectBlocks(editor)
  const shortage = count - existingBlocks.length
  if (shortage > 0) {
    console.log(`文档现有 ${existingBlocks.length} 块，需额外创建 ${shortage} 块...`)
    createBlocksInDocument(editor, shortage)
  }

  // 2. 强制保存文档到后端（确保 content_json 包含所有块）。
  // 中文说明：大文档 benchmark 会直接替换编辑器内存态，但普通 auto save 可能因 dirty=false 被跳过。
  // seed 写 pending 前必须让后端 content_json 与当前 editor rootBlock 对齐，否则后端 blockExists 会拒绝写入。
  console.log('保存文档到后端...')
  const saved = await persistCurrentEditorContentForSeed(editor, documentId)
  if (!saved) {
    console.error('文档保存失败，中止 pending 生成。')
    return null
  }

  if (clearExisting) {
    const clearResult = await workspaceGateway['clear-all-pending-revisions']({ documentId })
    if (!clearResult.success) {
      console.error('清理旧 pending 失败:', clearResult.error)
      return null
    }
    console.log(`[RevisionTest] 已清理旧 pending: ${clearResult.data.deletedCount}`)
  }

  const allBlocks = collectBlocks(editor)
  const targetBlocks = allBlocks.slice(0, count)
  const uniqueTargetBlockIds = new Set(targetBlocks.map(block => block.blockId))
  if (uniqueTargetBlockIds.size !== targetBlocks.length) {
    console.error(
      `[RevisionTest] 当前文档 rootBlock ID 不唯一，已中止 pending 生成: unique=${uniqueTargetBlockIds.size}, total=${targetBlocks.length}`
    )
    return null
  }

  const invalidTargetBlockIds = targetBlocks
    .map(block => block.blockId)
    .filter(blockId => !isValidEditorNodeId(blockId))
  if (invalidTargetBlockIds.length > 0) {
    console.error(
      '[RevisionTest] 当前文档存在非法 rootBlock ID，已中止 pending 生成。请先用默认 clearExisting=true 重新 seed。',
      invalidTargetBlockIds.slice(0, 10)
    )
    return null
  }

  const revisions = buildFakeRevisions(targetBlocks)

  // 3. 批量写入 pending revisions 到后端
  console.log(
    `批量写入 ${targetBlocks.length} 个 pending revisions 到后端，chunkSize=${chunkSize}...`
  )
  const writeResult = await writePendingRevisionsInChunks({ documentId, revisions, chunkSize })
  if (!writeResult) return null

  console.log(`后端写入完成: ${writeResult.writtenCount}/${writeResult.totalRequested}`)
  if (writeResult.errors.length > 0) {
    console.warn('部分块写入失败:', writeResult.errors.slice(0, 20))
  }

  // 4. 重新从后端读取真实 DTO
  console.log('从后端读取最新 pending revisions...')
  const readResult = await workspaceGateway['read-document']({ documentId })
  if (!readResult.success) {
    console.error('读取失败:', readResult.error)
    return null
  }

  const pendingDTOs = readResult.data.pendingRevisions ?? []
  console.log(`后端返回 ${pendingDTOs.length} 个 pending revisions`)

  if (!assertExactPendingCoverage({ targetBlocks, pendingDTOs })) {
    console.error(
      '[RevisionTest] seed 已中止：请不要用不完整 pending 数据继续做 10000 pending 压测。'
    )
    return null
  }

  return {
    documentId,
    pendingCount: pendingDTOs.length,
    storePendingDTOs: options.applyToFrontend ? pendingDTOs : undefined,
  }
}

/**
 * 注入 N 个假修订到当前文档。
 *
 * 完整流程：
 * 1. 如果块不够 → 创建补齐
 * 2. save-document → 确保后端 content_json 有这些块（assertBlockExists 需要）
 * 3. set-pending-revisions-batch → 写入后端 pending_revisions 表
 * 4. read-document → 获取真实 DTO
 * 5. setWorkspacePendingRevisions → 注入前端 store（投影 marks）
 */
async function inject(count = 100): Promise<void> {
  const editor = getEditor()
  if (!editor) return

  console.group(`[RevisionTest] inject(${count}) 开始`)

  const prepared = await prepareBackendPending(count, { applyToFrontend: true })
  if (!prepared || !prepared.storePendingDTOs) {
    console.groupEnd()
    return
  }

  // 注入前端 store
  const store = useRevisionStore(editor)
  store.setWorkspacePendingRevisions(prepared.storePendingDTOs)

  requestAnimationFrame(() => {
    console.log('canonical session 数量:', store.canonicalPendingBlockCount.value)
    console.log('canonical 统计:', store.canonicalPendingStats.value)
    console.groupEnd()
  })
}

/**
 * 只生成后端 pending，不立刻投影前端。
 *
 * 用途：
 * - 测试“重新打开文档时加载超大 pending”的真实链路；
 * - 例如：`await window.__REVISION_TEST__.seed(10000)` 后切换到别的文档再切回来。
 */
async function seed(count = 10000, options: SeedOptions = {}): Promise<void> {
  console.group(`[RevisionTest] seed(${count}) 开始`)
  const prepared = await prepareBackendPending(count, {
    ...options,
    applyToFrontend: false,
  })
  if (prepared) {
    console.log(
      `[RevisionTest] seed 完成: documentId=${prepared.documentId}, pendingCount=${prepared.pendingCount}`
    )
    console.log(
      '下一步：切换到其他文档再切回来，或重新打开当前文档，然后查看 window.__REVISION_PERF__.getLast()'
    )
  }
  console.groupEnd()
}

/**
 * 诊断后端 pending 与当前编辑器 rootBlock 是否匹配。
 */
async function diagnose(): Promise<void> {
  const editor = getEditor()
  if (!editor) return
  const documentId = getDocumentId()
  if (!documentId) return

  const blocks = collectBlocks(editor)
  const documentBlockIds = new Set(blocks.map(block => block.blockId))
  const readResult = await workspaceGateway['read-document']({ documentId })
  if (!readResult.success) {
    console.error('[RevisionTest] diagnose 读取文档失败:', readResult.error)
    return
  }

  const pending = readResult.data.pendingRevisions ?? []
  const pendingBlockIds = pending.map(dto => dto.blockId)
  const uniquePendingBlockIds = new Set(pendingBlockIds)
  const missingPendingBlockIds = pendingBlockIds.filter(blockId => !documentBlockIds.has(blockId))
  const duplicatePendingCount = pendingBlockIds.length - uniquePendingBlockIds.size

  console.group('[RevisionTest] pending 匹配诊断')
  console.table({
    documentBlockCount: blocks.length,
    uniqueDocumentBlockCount: documentBlockIds.size,
    pendingCount: pending.length,
    uniquePendingBlockCount: uniquePendingBlockIds.size,
    duplicatePendingCount,
    matchingPendingCount: pending.length - missingPendingBlockIds.length,
    missingPendingCount: missingPendingBlockIds.length,
  })
  if (missingPendingBlockIds.length > 0) {
    console.warn(
      '[RevisionTest] 找不到对应 rootBlock 的 pending 样本:',
      missingPendingBlockIds.slice(0, 20)
    )
  }
  console.groupEnd()
}

/**
 * 诊断当前滚动窗口里的 pending 分类。
 *
 * 中文说明：
 * - 读取最近一次 Shell pending projection/header 的内存样本，不主动触发投影；
 * - 把候选块、已 active 块、非 pending 块放到同一张表里；
 * - 用于判断“往下滚动没有 pending”到底是测试数据没覆盖，还是 header/diff 渲染没跟上。
 */
async function diagnoseWindow(blockIds: string[] = []): Promise<void> {
  const editor = getEditor()
  if (!editor) return
  const documentId = getDocumentId()
  if (!documentId) return

  const pendingPerf = readLatestPendingProjectionPerf()
  const headerPerf = readLatestShellHeaderPerf()
  const enginePerf = readLatestRenderVirtualizationPerf()
  const sample = pickDiagnoseWindowSample({
    explicitBlockIds: blockIds,
    currentViewportBlockIds: collectCurrentViewportBlockIds(editor),
    pendingPerf,
    headerPerf,
    enginePerf,
  })
  const sampledBlockIds = sample.blockIds

  if (sampledBlockIds.length === 0) {
    console.warn('[RevisionTest] diagnoseWindow 没有可诊断的 blockId 样本。请先滚动一次，再读取。')
    return
  }

  const blocks = collectBlocks(editor)
  const blockIndex = new Map(blocks.map((block, index) => [block.blockId, index + 1]))
  const store = useRevisionStore(editor)
  const readResult = await workspaceGateway['read-document']({ documentId })
  const backendPendingBlockIds = new Set<string>()
  if (readResult.success) {
    for (const dto of readResult.data.pendingRevisions ?? []) {
      if (typeof dto.blockId === 'string') backendPendingBlockIds.add(dto.blockId)
    }
  }
  const virtualizationState = getRenderVirtualizationState(editor.view.state)
  const selectedRootBlockId = findSelectionRootBlockId(editor.state)

  const rows = sampledBlockIds.map(blockId => {
    const rootPos = findRootBlockPosById(editor, blockId)
    const scan = rootPos == null ? null : scanBlockForRevisions(editor, rootPos)
    const outer = editor.view.dom.querySelector<HTMLElement>(
      `.root-block-outer[data-id="${escapeCssAttributeValue(blockId)}"]`
    )
    const header =
      outer?.querySelector<HTMLElement>(`[${ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR}="true"]`) ?? null
    const canonical = store.getCanonicalSession(blockId)
    const active = store.getRevisionState(blockId)
    const backendPending = backendPendingBlockIds.has(blockId)
    const activeStatus = active?.status ?? null
    const docMark = scan?.revisionId ?? null
    const placeholder = outer?.dataset.placeholder === 'true'
    const headerHidden = header ? header.hidden : null

    return {
      blockIndex: blockIndex.get(blockId) ?? '(missing)',
      blockId,
      sampleSource: sample.source,
      category: describeCurrentRevisionCategory({
        backendPending,
        canonical: Boolean(canonical),
        activeStatus,
        docMark,
        placeholder,
        headerHidden,
      }),
      perfCategory: pendingPerf.candidateBlockIds.includes(blockId)
        ? 'candidate'
        : pendingPerf.skippedActiveBlockIds.includes(blockId)
          ? 'active'
          : pendingPerf.skippedNonPendingBlockIds.includes(blockId)
            ? 'non-pending'
            : '',
      backendPending,
      canonical: Boolean(canonical),
      activeStatus: activeStatus ?? '(none)',
      docMark: docMark ?? '(none)',
      pluginHydrated: virtualizationState?.hydratedSet.has(blockId) ?? '(no-plugin)',
      pluginPinned: virtualizationState?.pinnedSet.has(blockId) ?? '(no-plugin)',
      pluginSelection: selectedRootBlockId === blockId,
      renderMode: outer?.getAttribute('data-root-block-render-mode') ?? '(no-dom)',
      placeholder: outer?.dataset.placeholder ?? '(no-dom)',
      headerSlot: Boolean(header),
      headerHidden: headerHidden ?? '(no-header)',
      headerText: header?.textContent?.trim() ?? '',
      headerSample: headerPerf.renderedBlockIds.includes(blockId)
        ? 'rendered'
        : headerPerf.sessionMissBlockIds.includes(blockId)
          ? 'session-miss'
          : headerPerf.slotMissBlockIds.includes(blockId)
            ? 'slot-miss'
            : headerPerf.outerMissBlockIds.includes(blockId)
              ? 'outer-miss'
              : '',
    }
  })

  console.group('[RevisionTest] 当前窗口 pending 诊断')
  console.log('[RevisionTest] diagnoseWindow 样本来源:', {
    sampleSource: sample.source,
    sampledCount: sampledBlockIds.length,
    currentDomCount:
      sample.source === 'current-dom'
        ? sampledBlockIds.length
        : collectCurrentViewportBlockIds(editor).length,
    enginePerfVisibleCount: enginePerf.visibleBlockIds.length,
    enginePerfHydratedCount: enginePerf.hydratedBlockIds.length,
  })
  console.table(rows)
  console.log(
    '说明：默认优先诊断当前 DOM 视口，不再混用历史 perf 样本；perfCategory 只是最近一次投影决策的辅助标签。'
  )
  if (!readResult.success) {
    console.warn('[RevisionTest] 后端 pending 读取失败，backendPending 列不可用:', readResult.error)
  }
  console.groupEnd()
}

/**
 * 已废弃：禁止再制造“只写前端、不写 pending”的孤儿 revisionMark。
 * 如需调试，请统一使用 inject()，先写后端 pending，再走正式加载链路。
 */
function injectFrontendOnly(_count = 100): void {
  console.warn(
    '[RevisionTest] injectFrontendOnly 已废弃。请改用 inject()，所有修订都必须先写入块级 pending。'
  )
}

/**
 * 打印当前 canonical sessions 状态
 */
function dump(): void {
  const editor = getEditor()
  if (!editor) return

  const store = useRevisionStore(editor)
  console.group('[RevisionTest] 当前 Canonical Sessions 状态')
  console.log('块数量:', store.canonicalPendingBlockCount.value)
  console.log('是否有 pending:', store.canonicalHasAnyPending.value)
  console.log('统计:', store.canonicalPendingStats.value)
  console.table(
    Object.values(store.canonicalPendingSessions.value).map(s => ({
      blockId: s.blockId,
      pendingId: s.pendingId,
      operation: s.operation,
      revisionId: s.revisionId,
      insertCount: s.diffStats?.insertCount ?? '(未回填)',
      deleteCount: s.diffStats?.deleteCount ?? '(未回填)',
    }))
  )
  console.groupEnd()
}

/**
 * 清除所有修订（后端 pending + 前端 store + 文档 marks）
 */
async function clear(): Promise<void> {
  const editor = getEditor()
  if (!editor) return
  const documentId = getDocumentId()
  if (!documentId) return

  // 先清后端
  const result = await workspaceGateway['clear-all-pending-revisions']({ documentId })
  if (result.success) {
    console.log(`[RevisionTest] 后端已清理 ${result.data.deletedCount} 条 pending revisions`)
  }

  // 再清前端文档中的 revisionMark（包含前端孤儿测试 mark）
  const devEditor = editor as DevEditor
  const blocks = collectBlocks(editor)
  for (const block of blocks) {
    devEditor.commands.clearBlockRevisionMarks(block.rootPos, null)
  }

  // 最后清前端 store
  const store = useRevisionStore(editor)
  store.clearAllRevisions()
  console.log('[RevisionTest] 前端 store 与文档 marks 已清理')
}

// 挂载到 window
if (typeof window !== 'undefined') {
  const win = window as unknown as Record<string, unknown>
  win.__REVISION_TEST__ = {
    inject,
    seed,
    diagnose,
    diagnoseWindow,
    injectFrontendOnly,
    dump,
    clear,
  }
  console.log('[RevisionTest] 调试工具已挂载。用法: window.__REVISION_TEST__.seed(10000)')
}

export { inject, seed, diagnose, diagnoseWindow, injectFrontendOnly, dump, clear }
