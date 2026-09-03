/**
 * renderVirtualizationDiagnostics.ts
 *
 * RootBlock 渲染虚拟化的浏览器交互诊断入口。
 *
 * 中文说明：
 * - 这个模块只读 editor / doc / plugin state / DOM，不写业务状态；
 * - 用于 DevTools 手动验证真实 Chromium 交互，例如首尾跳转、placeholder 数量、selection 所在块；
 * - 不接 Pinia / Revision / Annotation，避免把诊断工具变成新的耦合点。
 */

import type { EditorState } from 'prosemirror-state'
import {
  findSelectionRootBlockId,
  getRenderVirtualizationState,
  isRootBlockHydratedByVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import { ROOT_BLOCK_RENDER_MODE_DATA_ATTR } from '../view/rootBlockRenderMode'
import { collectRootBlockIdsFromDoc } from '../functions/collectRootBlockIds'

const ROOT_BLOCK_SELECTOR = '.root-block-outer[data-id]'
const GLOBAL_DIAG_KEY = '__EDITOR_VIRTUALIZATION_DIAG__'
const GLOBAL_EDITOR_KEY = '__TIPTAP_EDITOR__'

export interface RenderVirtualizationDiagnosticsEditorView {
  state: EditorState
  dom: HTMLElement
}

export interface RenderVirtualizationDiagnosticsEditor {
  state: EditorState
  view: RenderVirtualizationDiagnosticsEditorView
  isDestroyed?: boolean
}

interface RootBlockProbe {
  blockId: string
  domPresent: boolean
  domRenderMode: string | null
  placeholderDom: boolean
  hydratedByVirtualization: boolean
  pinnedByVirtualization: boolean
  selectedByEditor: boolean
}

interface RootBlockDomStats {
  rootBlockDomCount: number
  placeholderDomCount: number
  hydratedDomCount: number
}

export interface RenderVirtualizationDiagnosticsSnapshot {
  ok: boolean
  reason?: string
  virtualizationEnabled: boolean
  docRootBlockCount: number
  dom: RootBlockDomStats
  hydratedSetCount: number
  pinnedSetCount: number
  selectedRootBlockId: string | null
  firstRootBlock: RootBlockProbe | null
  lastRootBlock: RootBlockProbe | null
}

export interface RenderVirtualizationKeyProbeResult {
  ok: boolean
  reason?: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  expectedBoundaryTargetBlockId: string | null
  before: RenderVirtualizationDiagnosticsSnapshot
  after: RenderVirtualizationDiagnosticsSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEditorViewLike(value: unknown): value is RenderVirtualizationDiagnosticsEditorView {
  if (!isRecord(value)) return false
  return isRecord(value.state) && value.dom instanceof HTMLElement
}

function isEditorLike(value: unknown): value is RenderVirtualizationDiagnosticsEditor {
  if (!isRecord(value)) return false
  return isRecord(value.state) && isEditorViewLike(value.view)
}

function readGlobalEditor(): RenderVirtualizationDiagnosticsEditor | null {
  if (typeof window === 'undefined') return null
  const record = window as unknown as Record<string, unknown>
  const editor = record[GLOBAL_EDITOR_KEY]
  return isEditorLike(editor) && editor.isDestroyed !== true ? editor : null
}

function findRootBlockElement(
  view: RenderVirtualizationDiagnosticsEditorView,
  blockId: string
): HTMLElement | null {
  const escapedBlockId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(blockId)
    : blockId.replace(/["\\]/g, '\\$&')
  const element = view.dom.querySelector(`${ROOT_BLOCK_SELECTOR}[data-id="${escapedBlockId}"]`)
  return element instanceof HTMLElement ? element : null
}

function isPlaceholderRootBlockElement(element: HTMLElement): boolean {
  return (
    element.dataset.placeholder === 'true' ||
    element.getAttribute(ROOT_BLOCK_RENDER_MODE_DATA_ATTR) === 'placeholder' ||
    element.classList.contains('root-block-virtual-placeholder')
  )
}

function collectRootBlockDomStats(view: RenderVirtualizationDiagnosticsEditorView): RootBlockDomStats {
  const elements = Array.from(view.dom.querySelectorAll(ROOT_BLOCK_SELECTOR)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  )
  const placeholderDomCount = elements.filter(isPlaceholderRootBlockElement).length

  return {
    rootBlockDomCount: elements.length,
    placeholderDomCount,
    hydratedDomCount: elements.length - placeholderDomCount,
  }
}

function probeRootBlock(editor: RenderVirtualizationDiagnosticsEditor, blockId: string): RootBlockProbe {
  const virtualizationState = getRenderVirtualizationState(editor.state)
  const element = findRootBlockElement(editor.view, blockId)
  const selectedRootBlockId = findSelectionRootBlockId(editor.state)

  return {
    blockId,
    domPresent: Boolean(element),
    domRenderMode: element?.getAttribute(ROOT_BLOCK_RENDER_MODE_DATA_ATTR) ?? null,
    placeholderDom: element ? isPlaceholderRootBlockElement(element) : false,
    hydratedByVirtualization: isRootBlockHydratedByVirtualizationState(editor.state, blockId),
    pinnedByVirtualization: virtualizationState?.pinnedSet.has(blockId) ?? false,
    selectedByEditor: selectedRootBlockId === blockId,
  }
}

function createMissingEditorSnapshot(reason: string): RenderVirtualizationDiagnosticsSnapshot {
  return {
    ok: false,
    reason,
    virtualizationEnabled: false,
    docRootBlockCount: 0,
    dom: {
      rootBlockDomCount: 0,
      placeholderDomCount: 0,
      hydratedDomCount: 0,
    },
    hydratedSetCount: 0,
    pinnedSetCount: 0,
    selectedRootBlockId: null,
    firstRootBlock: null,
    lastRootBlock: null,
  }
}

export function collectRenderVirtualizationDiagnostics(
  editor: RenderVirtualizationDiagnosticsEditor | null = readGlobalEditor()
): RenderVirtualizationDiagnosticsSnapshot {
  if (!editor) {
    return createMissingEditorSnapshot('未找到可用的 window.__TIPTAP_EDITOR__')
  }

  const virtualizationState = getRenderVirtualizationState(editor.state)
  const rootBlockIds = collectRootBlockIdsFromDoc(editor.state.doc)
  const firstBlockId = rootBlockIds[0] ?? null
  const lastBlockId = rootBlockIds[rootBlockIds.length - 1] ?? null
  const selectedRootBlockId = findSelectionRootBlockId(editor.state)

  return {
    ok: true,
    virtualizationEnabled: virtualizationState?.enabled ?? false,
    docRootBlockCount: rootBlockIds.length,
    dom: collectRootBlockDomStats(editor.view),
    hydratedSetCount: virtualizationState?.hydratedSet.size ?? 0,
    pinnedSetCount: virtualizationState?.pinnedSet.size ?? 0,
    selectedRootBlockId,
    firstRootBlock: firstBlockId ? probeRootBlock(editor, firstBlockId) : null,
    lastRootBlock: lastBlockId ? probeRootBlock(editor, lastBlockId) : null,
  }
}

function resolveExpectedBoundaryTargetBlockId(
  snapshot: RenderVirtualizationDiagnosticsSnapshot,
  key: string,
  init: KeyboardEventInit
): string | null {
  if (init.altKey || (init.ctrlKey && init.metaKey)) return null

  if (init.ctrlKey && !init.metaKey) {
    if (key === 'Home') return snapshot.firstRootBlock?.blockId ?? null
    if (key === 'End') return snapshot.lastRootBlock?.blockId ?? null
    return null
  }

  if (init.metaKey && !init.ctrlKey) {
    if (key === 'Home' || key === 'ArrowUp') return snapshot.firstRootBlock?.blockId ?? null
    if (key === 'End' || key === 'ArrowDown') return snapshot.lastRootBlock?.blockId ?? null
  }

  return null
}

export function dispatchRenderVirtualizationKeyProbe(
  key: string,
  init: KeyboardEventInit = {},
  editor: RenderVirtualizationDiagnosticsEditor | null = readGlobalEditor()
): RenderVirtualizationKeyProbeResult {
  const before = collectRenderVirtualizationDiagnostics(editor)
  const normalizedInit: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    ...init,
    key,
  }

  if (!editor) {
    return {
      ok: false,
      reason: '未找到可用的 window.__TIPTAP_EDITOR__',
      key,
      ctrlKey: Boolean(normalizedInit.ctrlKey),
      metaKey: Boolean(normalizedInit.metaKey),
      altKey: Boolean(normalizedInit.altKey),
      shiftKey: Boolean(normalizedInit.shiftKey),
      defaultPrevented: false,
      expectedBoundaryTargetBlockId: null,
      before,
      after: before,
    }
  }

  const event = new KeyboardEvent('keydown', normalizedInit)
  editor.view.dom.dispatchEvent(event)
  const after = collectRenderVirtualizationDiagnostics(editor)

  return {
    ok: true,
    key,
    ctrlKey: Boolean(normalizedInit.ctrlKey),
    metaKey: Boolean(normalizedInit.metaKey),
    altKey: Boolean(normalizedInit.altKey),
    shiftKey: Boolean(normalizedInit.shiftKey),
    defaultPrevented: event.defaultPrevented,
    expectedBoundaryTargetBlockId: resolveExpectedBoundaryTargetBlockId(before, key, normalizedInit),
    before,
    after,
  }
}

function printSnapshot(): RenderVirtualizationDiagnosticsSnapshot {
  const snapshot = collectRenderVirtualizationDiagnostics()
  console.log('[RenderVirtualizationDiag] snapshot', snapshot)
  return snapshot
}

function printKeyProbe(key: string, init: KeyboardEventInit = {}): RenderVirtualizationKeyProbeResult {
  const result = dispatchRenderVirtualizationKeyProbe(key, init)
  console.log('[RenderVirtualizationDiag] key probe', result)
  return result
}

export function installRenderVirtualizationDiagnostics(): void {
  if (typeof window === 'undefined') return

  const record = window as unknown as Record<string, unknown>
  record[GLOBAL_DIAG_KEY] = {
    snapshot: collectRenderVirtualizationDiagnostics,
    print: printSnapshot,
    key: printKeyProbe,
  }
}

installRenderVirtualizationDiagnostics()
