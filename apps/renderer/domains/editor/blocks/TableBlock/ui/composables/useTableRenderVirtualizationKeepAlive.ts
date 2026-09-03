/**
 * useTableRenderVirtualizationKeepAlive.ts
 *
 * TableBlock 浮层与 RootBlock 渲染虚拟化之间的保活桥。
 *
 * 中文说明：
 * - 表格坐标轴、单元格 handle 等 UI 依赖真实 table/cell DOM 测量；
 * - 这些 UI 打开期间，所在 rootBlock 不能被替换成 placeholder；
 * - 本 composable 只根据 table/cell 的 ProseMirror position 声明保活，不直接依赖虚拟化 controller。
 */

import { getCurrentInstance, inject, onBeforeUnmount, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import {
  applyRenderVirtualizationKeepAliveCommand,
  findRootBlockIdAtDocumentPosition,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  type RenderVirtualizationKeepAlivePort,
  type RenderVirtualizationKeepAliveReason,
} from '../../../../features/RenderVirtualization'

export type TableVirtualizationEditor = Pick<Editor, 'state'> & {
  isDestroyed?: boolean
  view?: {
    dom?: EventTarget | null
  } | null
}

type ReadableRef<T> = {
  readonly value: T
}

export interface UseTableRenderVirtualizationKeepAliveOptions {
  editor: ReadableRef<TableVirtualizationEditor | null | undefined>
  activePos: ReadableRef<number | null | undefined>
  activeBlockId?: ReadableRef<string | null | undefined>
  reason?: RenderVirtualizationKeepAliveReason
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
}

export interface UseTableRenderVirtualizationKeepAliveReturn {
  release: () => void
}

export function useTableRenderVirtualizationKeepAlive(
  options: UseTableRenderVirtualizationKeepAliveOptions
): UseTableRenderVirtualizationKeepAliveReturn {
  let pinnedBlockId: string | null = null
  let activeDispatchTarget: EventTarget | null = null
  const injectedKeepAlivePort = getCurrentInstance()
    ? inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null)
    : null

  function readEditor(): TableVirtualizationEditor | null {
    const editor = options.editor.value
    if (!editor || editor.isDestroyed) return null
    return editor
  }

  function readEditorDom(editor: TableVirtualizationEditor | null): EventTarget | null {
    return editor?.view?.dom ?? null
  }

  function dispatchTableKeepAlive(
    target: EventTarget | null,
    blockId: string,
    active: boolean
  ): boolean {
    if (blockId.length === 0) return false

    return applyRenderVirtualizationKeepAliveCommand({
      port: options.keepAlivePort ?? injectedKeepAlivePort,
      legacyTarget: target,
      command: {
        blockId,
        reason: options.reason ?? 'interaction-open',
      },
      active,
    })
  }

  function releasePinnedBlock(target: EventTarget | null = activeDispatchTarget): void {
    if (!pinnedBlockId) return

    dispatchTableKeepAlive(target, pinnedBlockId, false)
    pinnedBlockId = null
  }

  function refreshDispatchTarget(editor: TableVirtualizationEditor | null): EventTarget | null {
    const nextTarget = readEditorDom(editor)
    if (nextTarget === activeDispatchTarget) return activeDispatchTarget

    // 中文说明：Editor 重建或文档切换时，要先向旧 DOM 成对释放，避免旧 bridge 残留 pin。
    releasePinnedBlock(activeDispatchTarget)
    activeDispatchTarget = nextTarget
    return activeDispatchTarget
  }

  function readTargetBlockId(editor: TableVirtualizationEditor | null): string | null {
    const explicitBlockId = options.activeBlockId?.value
    if (typeof explicitBlockId === 'string' && explicitBlockId.length > 0) {
      return explicitBlockId
    }

    const pos = options.activePos.value
    if (!editor || typeof pos !== 'number') return null

    return findRootBlockIdAtDocumentPosition(editor, pos)
  }

  function syncKeepAlive(): void {
    const editor = readEditor()
    const target = refreshDispatchTarget(editor)
    const nextBlockId = readTargetBlockId(editor)

    if (pinnedBlockId && pinnedBlockId !== nextBlockId) {
      releasePinnedBlock(target)
    }

    if (!nextBlockId || pinnedBlockId === nextBlockId) return

    if (dispatchTableKeepAlive(target, nextBlockId, true)) {
      pinnedBlockId = nextBlockId
    }
  }

  const stop = watch(
    [
      () => options.editor.value,
      () => options.activePos.value,
      () => options.activeBlockId?.value,
    ],
    syncKeepAlive,
    { immediate: true }
  )

  function release(): void {
    stop()
    releasePinnedBlock(activeDispatchTarget)
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(release)
  }

  return { release }
}
