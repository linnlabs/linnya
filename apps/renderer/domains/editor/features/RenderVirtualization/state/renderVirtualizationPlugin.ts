/**
 * renderVirtualizationPlugin.ts
 *
 * RootBlock 渲染虚拟化的 ProseMirror 状态源。
 *
 * 中文说明：
 * - enabled=true 时，默认 rootBlock 是 placeholder；
 * - 只有 hydrated / pinned 小集合会生成 node decoration，避免 10000 个离屏块各自携带 decoration；
 * - NodeView 通过 plugin state 判断默认模式，通过 decoration 感知单块 hydrate / dehydrate 变化。
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState, type Selection, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { getBlockPosIndex } from '../../../extensions/position/blockPosIndex'
import {
  ROOT_BLOCK_RENDER_MODE_DATA_ATTR,
  ROOT_BLOCK_RENDER_MODE_SPEC_KEY,
} from '../view/rootBlockRenderMode'
import { recordDecorationSetPerfSample } from '../debug/decorationSetRuntimePerf'
import { MIN_RENDER_WINDOW_BLOCK_COUNT } from '../renderVirtualizationConstants'
import { readRootBlockId } from '../functions/readRootBlockAttrs'

export const renderVirtualizationPluginKey = new PluginKey<RenderVirtualizationState>(
  'renderVirtualization'
)

export const RENDER_VIRTUALIZATION_META_KEY = 'renderVirtualization'
// 中文说明：初始 hydrated 数量必须和运行时窗口保持同一量级。
// 如果这里先同步创建 100+ Vue NodeView，再由虚拟化引擎缩回窗口，Vue/Tiptap 后续 flush 仍会卡住事件循环。
export const DEFAULT_INITIAL_HYDRATED_ROOT_BLOCK_COUNT = MIN_RENDER_WINDOW_BLOCK_COUNT

export interface RenderVirtualizationMeta {
  setEnabled?: boolean
  hydrate?: readonly string[]
  dehydrate?: readonly string[]
  pin?: readonly string[]
  unpin?: readonly string[]
  reset?: boolean
}

export interface RenderVirtualizationState {
  enabled: boolean
  hydratedSet: ReadonlySet<string>
  pinnedSet: ReadonlySet<string>
  decorations: DecorationSet
}

interface MutableRenderVirtualizationState {
  enabled: boolean
  hydratedSet: Set<string>
  pinnedSet: Set<string>
  decorations: DecorationSet
}

class ReadonlySetSnapshot<T> implements ReadonlySet<T> {
  private readonly valuesSet: Set<T>

  constructor(values: Iterable<T>) {
    this.valuesSet = new Set(values)
  }

  get size(): number {
    return this.valuesSet.size
  }

  has(value: T): boolean {
    return this.valuesSet.has(value)
  }

  forEach(
    callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void,
    thisArg?: unknown
  ): void {
    this.valuesSet.forEach((value) => {
      callbackfn.call(thisArg, value, value, this)
    })
  }

  entries(): SetIterator<[T, T]> {
    return this.valuesSet.entries()
  }

  keys(): SetIterator<T> {
    return this.valuesSet.keys()
  }

  values(): SetIterator<T> {
    return this.valuesSet.values()
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.valuesSet[Symbol.iterator]()
  }
}

export interface PrepareInitialRenderVirtualizationOptions {
  enabled: boolean
  initialHydratedBlockCount?: number
}

function createInitialState(doc: ProseMirrorNode): RenderVirtualizationState {
  return freezeState({
    enabled: false,
    hydratedSet: new Set(),
    pinnedSet: new Set(),
    decorations: DecorationSet.create(doc, []),
  })
}

function cloneState(state: RenderVirtualizationState): MutableRenderVirtualizationState {
  return {
    enabled: state.enabled,
    hydratedSet: new Set(state.hydratedSet),
    pinnedSet: new Set(state.pinnedSet),
    decorations: state.decorations,
  }
}

function freezeState(state: MutableRenderVirtualizationState): RenderVirtualizationState {
  return {
    enabled: state.enabled,
    hydratedSet: new ReadonlySetSnapshot(state.hydratedSet),
    pinnedSet: new ReadonlySetSnapshot(state.pinnedSet),
    decorations: state.decorations,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: keyof RenderVirtualizationMeta
): boolean | undefined | null {
  if (!(key in record)) return undefined
  if (record[key] === undefined) return undefined
  return typeof record[key] === 'boolean' ? record[key] : null
}

function readOptionalStringArray(
  record: Record<string, unknown>,
  key: keyof RenderVirtualizationMeta
): readonly string[] | undefined | null {
  if (!(key in record)) return undefined
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === 'string')) return null
  return value.filter((item) => item.length > 0)
}

function parseRenderVirtualizationMeta(value: unknown): RenderVirtualizationMeta | null {
  if (!isRecord(value)) return null

  const setEnabled = readOptionalBoolean(value, 'setEnabled')
  if (setEnabled === null) {
    throw new Error('[RenderVirtualization] meta.setEnabled 必须是 boolean')
  }
  const reset = readOptionalBoolean(value, 'reset')
  if (reset === null) {
    throw new Error('[RenderVirtualization] meta.reset 必须是 boolean')
  }
  const hydrate = readOptionalStringArray(value, 'hydrate')
  if (hydrate === null) {
    throw new Error('[RenderVirtualization] meta.hydrate 必须是 string[]')
  }
  const dehydrate = readOptionalStringArray(value, 'dehydrate')
  if (dehydrate === null) {
    throw new Error('[RenderVirtualization] meta.dehydrate 必须是 string[]')
  }
  const pin = readOptionalStringArray(value, 'pin')
  if (pin === null) {
    throw new Error('[RenderVirtualization] meta.pin 必须是 string[]')
  }
  const unpin = readOptionalStringArray(value, 'unpin')
  if (unpin === null) {
    throw new Error('[RenderVirtualization] meta.unpin 必须是 string[]')
  }

  const parsed: RenderVirtualizationMeta = {}
  if (typeof setEnabled === 'boolean') parsed.setEnabled = setEnabled
  if (typeof reset === 'boolean') parsed.reset = reset
  if (hydrate) parsed.hydrate = hydrate
  if (dehydrate) parsed.dehydrate = dehydrate
  if (pin) parsed.pin = pin
  if (unpin) parsed.unpin = unpin

  return Object.keys(parsed).length > 0 ? parsed : null
}

function readMeta(tr: Transaction): RenderVirtualizationMeta | null {
  return (
    parseRenderVirtualizationMeta(tr.getMeta(renderVirtualizationPluginKey)) ??
    parseRenderVirtualizationMeta(tr.getMeta(RENDER_VIRTUALIZATION_META_KEY))
  )
}

function applyIdList(target: Set<string>, ids: readonly string[] | undefined, action: 'add' | 'delete'): void {
  if (!ids) return

  for (const id of ids) {
    if (!id) continue
    if (action === 'add') {
      target.add(id)
    } else {
      target.delete(id)
    }
  }
}

function collectFirstRootBlockIds(doc: ProseMirrorNode, limit: number): string[] {
  if (limit <= 0) return []

  const blockIds: string[] = []
  doc.descendants((node) => {
    if (blockIds.length >= limit) return false
    if (node.type.name !== 'rootBlock') return true

    const blockId = readRootBlockId(node)
    if (blockId) blockIds.push(blockId)

    return false
  })

  return blockIds
}

export function findSelectionRootBlockId(state: EditorState): string | null {
  return findRootBlockIdAtSelection(state.selection)
}

function findRootBlockIdAtSelection(selection: Selection): string | null {
  const nodeAfter = selection.$from.nodeAfter
  if (nodeAfter?.type.name === 'rootBlock') {
    return readRootBlockId(nodeAfter)
  }

  for (let depth = selection.$from.depth; depth >= 0; depth -= 1) {
    const node = selection.$from.node(depth)
    if (node.type.name === 'rootBlock') {
      return readRootBlockId(node)
    }
  }

  return null
}

function buildDecorations(
  doc: ProseMirrorNode,
  enabled: boolean,
  hydratedSet: ReadonlySet<string>,
  pinnedSet: ReadonlySet<string>
): DecorationSet {
  const startedAt = performance.now()
  if (!enabled) return DecorationSet.empty

  const activeBlockIds = new Set([...hydratedSet, ...pinnedSet])
  if (activeBlockIds.size === 0) {
    return DecorationSet.empty
  }

  // 中文说明：selection 变化很频繁，不能每次为了少量 hydrated/pinned 块全量扫描 10000 个 rootBlock。
  // getBlockPosIndex 以不可变 doc 为 key 缓存 blockId -> pos，同一 doc 内后续 selection transaction 都是 O(activeBlockIds)。
  const blockPosIndex = getBlockPosIndex(doc)
  const decorations: Decoration[] = []
  for (const blockId of activeBlockIds) {
    const from = blockPosIndex.get(blockId)
    if (typeof from !== 'number') continue

    const node = doc.nodeAt(from)
    if (node?.type.name !== 'rootBlock') continue

    decorations.push(
      Decoration.node(
        from,
        from + node.nodeSize,
        {
          [ROOT_BLOCK_RENDER_MODE_DATA_ATTR]: 'hydrated',
        },
        {
          [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'hydrated',
          blockId,
        }
      )
    )
  }

  decorations.sort((left, right) => left.from - right.from)

  const decorationSet = DecorationSet.create(doc, decorations)
  recordDecorationSetPerfSample({
    source: 'render-virtualization',
    decorationCount: decorations.length,
    startedAt,
    visitedNodeCount: activeBlockIds.size,
    trigger: 'window',
  })
  return decorationSet
}

function applyMetaToState(
  previous: RenderVirtualizationState,
  tr: Transaction,
  meta: RenderVirtualizationMeta | null
): RenderVirtualizationState {
  if (!meta && !tr.docChanged) {
    return previous
  }

  const next = cloneState(previous)

  if (meta?.reset) {
    next.enabled = false
    next.hydratedSet.clear()
    next.pinnedSet.clear()
  }

  if (typeof meta?.setEnabled === 'boolean') {
    next.enabled = meta.setEnabled
  }

  // 中文说明：同一帧内远距离拖动滚动条时，旧窗口 dehydrate 与新窗口 hydrate
  // 可能因为滚动纠偏、锚点补偿而短暂重叠。当前窗口必须拥有最终优先级，
  // 否则同一个 block 会被“先加后删”，表现为提交成功但可见窗口仍是 placeholder。
  applyIdList(next.hydratedSet, meta?.dehydrate, 'delete')
  applyIdList(next.hydratedSet, meta?.hydrate, 'add')
  applyIdList(next.pinnedSet, meta?.pin, 'add')
  applyIdList(next.pinnedSet, meta?.unpin, 'delete')

  next.decorations = buildDecorations(
    tr.doc,
    next.enabled,
    next.hydratedSet,
    next.pinnedSet
  )
  return freezeState(next)
}

export function createRenderVirtualizationPlugin(): Plugin<RenderVirtualizationState> {
  return new Plugin<RenderVirtualizationState>({
    key: renderVirtualizationPluginKey,
    state: {
      init(_, state) {
        return createInitialState(state.doc)
      },
      apply(tr, previous) {
        return applyMetaToState(previous, tr, readMeta(tr))
      },
    },
    props: {
      decorations(state) {
        return renderVirtualizationPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
  })
}

export function getRenderVirtualizationState(state: EditorState): RenderVirtualizationState | null {
  return renderVirtualizationPluginKey.getState(state) ?? null
}

export function isRootBlockHydratedByVirtualizationState(
  state: EditorState | null | undefined,
  blockId: string
): boolean {
  if (!state || !blockId) return true

  const virtualizationState = getRenderVirtualizationState(state)
  if (!virtualizationState || !virtualizationState.enabled) return true

  return (
    virtualizationState.hydratedSet.has(blockId) ||
    virtualizationState.pinnedSet.has(blockId)
  )
}

export function prepareInitialRenderVirtualizationState(
  state: EditorState,
  options: PrepareInitialRenderVirtualizationOptions
): EditorState {
  if (!options.enabled) return state

  const initialHydratedBlockCount =
    options.initialHydratedBlockCount ?? DEFAULT_INITIAL_HYDRATED_ROOT_BLOCK_COUNT
  const hydrate = collectFirstRootBlockIds(state.doc, initialHydratedBlockCount)

  return state.apply(
    state.tr.setMeta(renderVirtualizationPluginKey, {
      setEnabled: true,
      hydrate,
    } satisfies RenderVirtualizationMeta)
  )
}
