/**
 * focusedRootBlockSelection.ts
 *
 * editor 级 focused rootBlock 事实源。
 *
 * 中文说明：
 * - BlockChrome 数量会随着虚拟化窗口变化，不能每个 BlockChrome 都挂一组
 *   editor.on('update'/'selectionUpdate')；
 * - 这里按 editor 实例集中监听一次，再把 focused rootBlockId 暴露给所有订阅者；
 * - 这个文件只负责 UI 焦点事实，不负责虚拟化 keep-alive。selection 保活由
 *   RenderVirtualization Engine 写入 KeepAliveRegistry(reason='selection')。
 */

import {
  computed,
  onBeforeUnmount,
  shallowRef,
  type ComputedRef,
  type ShallowRef,
} from 'vue'
import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'
import { NodeSelection } from 'prosemirror-state'
import {
  recordEditorListenerAttached,
  recordEditorListenerDetached,
} from './blockChromeRuntimePerf'

export interface FocusedRootBlockSelectionEditor {
  state: EditorState
  on(eventName: 'update' | 'selectionUpdate', callback: () => void): void
  off(eventName: 'update' | 'selectionUpdate', callback: () => void): void
}

export interface FocusedRootBlockSelectionHandle {
  focusedRootBlockId: ShallowRef<string | null>
  selectedRootBlockId: ShallowRef<string | null>
  release: () => void
  refresh: () => void
}

interface FocusedRootBlockSelectionEntry {
  focusedRootBlockId: ShallowRef<string | null>
  selectedRootBlockId: ShallowRef<string | null>
  refresh: () => void
  release: () => void
  refCount: number
}

const focusedSelectionByEditor = new WeakMap<
  FocusedRootBlockSelectionEditor,
  FocusedRootBlockSelectionEntry
>()

function readRootBlockId(node: ProseMirrorNode): string | null {
  const id = node.attrs.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function findRootBlockIdAtResolvedPos($pos: ResolvedPos): string | null {
  const nodeAfter = $pos.nodeAfter
  if (nodeAfter?.type.name === 'rootBlock') {
    return readRootBlockId(nodeAfter)
  }

  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'rootBlock') {
      return readRootBlockId(node)
    }
  }

  return null
}

/**
 * 计算当前“块内焦点”所在 rootBlock。
 *
 * 中文说明：
 * - rootBlock 自身的 NodeSelection 不算 focused，它会走 selected 状态；
 * - 跨块文本选择不算 focused，避免多块选区时只有起点块显示完整 chrome；
 * - rootBlock 内部的图片 / 表格等 NodeSelection 仍算所在块 focused。
 */
export function findFocusedRootBlockId(state: EditorState): string | null {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'rootBlock') {
    return null
  }

  const fromBlockId = findRootBlockIdAtResolvedPos(selection.$from)
  if (!fromBlockId) return null

  const toBlockId = findRootBlockIdAtResolvedPos(selection.$to)
  return toBlockId === fromBlockId ? fromBlockId : null
}

/**
 * 计算当前 NodeSelection 选中的 rootBlock。
 *
 * 中文说明：focused 和 selected 是两类不同事实。focused 表示光标/子节点选区
 * 落在块内；selected 表示 rootBlock 自身被选中，后续 BlockChromeHost 需要
 * 同时消费这两类事实，但不能为它们各自安装一组 editor listener。
 */
export function findSelectedRootBlockId(state: EditorState): string | null {
  const { selection } = state
  if (!(selection instanceof NodeSelection)) return null
  if (selection.node.type.name !== 'rootBlock') return null
  return readRootBlockId(selection.node)
}

function createEntry(editor: FocusedRootBlockSelectionEditor): FocusedRootBlockSelectionEntry {
  const focusedRootBlockId = shallowRef<string | null>(findFocusedRootBlockId(editor.state))
  const selectedRootBlockId = shallowRef<string | null>(findSelectedRootBlockId(editor.state))

  const refresh = () => {
    focusedRootBlockId.value = findFocusedRootBlockId(editor.state)
    selectedRootBlockId.value = findSelectedRootBlockId(editor.state)
  }

  editor.on('update', refresh)
  editor.on('selectionUpdate', refresh)
  recordEditorListenerAttached({ owner: 'FocusedRootBlockSelection', eventName: 'update' })
  recordEditorListenerAttached({ owner: 'FocusedRootBlockSelection', eventName: 'selectionUpdate' })

  const entry: FocusedRootBlockSelectionEntry = {
    focusedRootBlockId,
    selectedRootBlockId,
    refresh,
    refCount: 0,
    release: () => {
      editor.off('update', refresh)
      editor.off('selectionUpdate', refresh)
      recordEditorListenerDetached({ owner: 'FocusedRootBlockSelection', eventName: 'update' })
      recordEditorListenerDetached({ owner: 'FocusedRootBlockSelection', eventName: 'selectionUpdate' })
      focusedSelectionByEditor.delete(editor)
    },
  }

  focusedSelectionByEditor.set(editor, entry)
  return entry
}

export function acquireFocusedRootBlockSelection(
  editor: FocusedRootBlockSelectionEditor
): FocusedRootBlockSelectionHandle {
  const entry = focusedSelectionByEditor.get(editor) ?? createEntry(editor)
  entry.refCount += 1

  let released = false
  return {
    focusedRootBlockId: entry.focusedRootBlockId,
    selectedRootBlockId: entry.selectedRootBlockId,
    refresh: entry.refresh,
    release: () => {
      if (released) return
      released = true
      entry.refCount -= 1
      if (entry.refCount <= 0) {
        entry.release()
      }
    },
  }
}

export function useFocusedRootBlockSelection(
  editor: FocusedRootBlockSelectionEditor
): ComputedRef<string | null> {
  const handle = acquireFocusedRootBlockSelection(editor)
  onBeforeUnmount(() => {
    handle.release()
  })

  return computed(() => handle.focusedRootBlockId.value)
}
