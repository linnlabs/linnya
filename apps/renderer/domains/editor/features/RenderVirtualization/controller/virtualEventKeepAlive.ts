/**
 * virtualEventKeepAlive.ts
 *
 * RootBlock 虚拟化的 DOM 交互保活输入层。
 *
 * 中文说明：
 * - composition / pointer / focus / toolbar 这类交互只产生“保活意图”；
 * - 真正 pin/unpin 仍由 KeepAliveRegistry + Controller 写入 PM plugin state；
 * - 这样 Engine 不再直接塞一堆 DOM listener 细节。
 */

import { shouldUseVirtualRootBlockRenderingForOwner } from '../../../ui/services/editorFeatureFlags'
import { hydrateKeyboardTargetRootBlock } from './keyboardPreHydration'
import {
  findSelectionRootBlockId,
  getRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import {
  isRenderVirtualizationKeepAliveReason,
} from '../state/keepAliveRegistry'
import type { RenderVirtualizationKeepAlivePort } from '../state/keepAlivePort'
import {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT,
  type RenderVirtualizationKeepAliveEvent,
} from '../state/keepAliveEvents'
import type {
  RenderVirtualizationEngineEditor,
} from './renderVirtualizationEngine'
import type { RenderVirtualizationRefreshReason } from './refreshReason'
import { readRootBlockIdFromEventTarget } from '../../../shared/rootBlockDom'

interface VirtualEventKeepAliveOptions {
  getEditor: () => RenderVirtualizationEngineEditor | null
  keepAlivePort: RenderVirtualizationKeepAlivePort
  scheduleRefresh: (reason: RenderVirtualizationRefreshReason) => void
}

interface EditorEventBusLike {
  on?: (eventName: string, listener: () => void) => void
  off?: (eventName: string, listener: () => void) => void
}

type EditorSelectionListenerEvent = 'selectionUpdate'

interface EditorSelectionListenerLike {
  on?: (eventName: EditorSelectionListenerEvent, listener: () => void) => void
  off?: (eventName: EditorSelectionListenerEvent, listener: () => void) => void
}

function isKeepAliveEvent(event: Event): event is RenderVirtualizationKeepAliveEvent {
  return event.type === RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT && event instanceof CustomEvent
}

export function createVirtualEventKeepAlive(options: VirtualEventKeepAliveOptions): {
  install: () => void
  cleanup: () => void
  syncSelectionKeepAlive: () => void
} {
  let installedEditorDom: HTMLElement | null = null
  let installedEventBus: EditorEventBusLike | null = null
  let installedSelectionEditor: EditorSelectionListenerLike | null = null
  let selectionLeaseBlockId: string | null = null

  function releaseSelectionLease(): void {
    if (!selectionLeaseBlockId) return
    options.keepAlivePort.release({ blockId: selectionLeaseBlockId, reason: 'selection' })
    selectionLeaseBlockId = null
  }

  function syncSelectionKeepAlive(): void {
    const editor = options.getEditor()
    if (!editor || editor.isDestroyed) {
      releaseSelectionLease()
      return
    }
    if (!shouldUseVirtualRootBlockRenderingForOwner(editor)) {
      releaseSelectionLease()
      return
    }
    if (getRenderVirtualizationState(editor.view.state)?.enabled !== true) {
      releaseSelectionLease()
      return
    }
    const nextBlockId = findSelectionRootBlockId(editor.state)
    if (nextBlockId === selectionLeaseBlockId) return

    releaseSelectionLease()
    if (!nextBlockId) return

    options.keepAlivePort.acquire({ blockId: nextBlockId, reason: 'selection' })
    selectionLeaseBlockId = nextBlockId
  }

  function pinSelectionBlockForComposition(): void {
    const editor = options.getEditor()
    if (!editor || editor.isDestroyed) return
    if (!shouldUseVirtualRootBlockRenderingForOwner(editor)) return
    const blockId = findSelectionRootBlockId(editor.state)
    if (!blockId) return
    options.keepAlivePort.releaseReason('composition')
    options.keepAlivePort.acquire({ blockId, reason: 'composition' })
  }

  function unpinCompositionBlock(): void {
    options.keepAlivePort.releaseReason('composition')
  }

  function unpinPointerBlock(): void {
    options.keepAlivePort.releaseReason('pointer')
    window.removeEventListener('pointerup', unpinPointerBlock)
    window.removeEventListener('pointercancel', unpinPointerBlock)
  }

  function pinPointerBlock(event: PointerEvent): void {
    const editor = options.getEditor()
    if (!editor || editor.isDestroyed) return
    if (!shouldUseVirtualRootBlockRenderingForOwner(editor)) return
    const blockId = readRootBlockIdFromEventTarget(event.target)
    if (!blockId) return
    unpinPointerBlock()
    options.keepAlivePort.acquire({ blockId, reason: 'pointer' })
    window.addEventListener('pointerup', unpinPointerBlock)
    window.addEventListener('pointercancel', unpinPointerBlock)
  }

  function unpinFocusBlock(event: FocusEvent): void {
    const nextFocusedBlockId = readRootBlockIdFromEventTarget(event.relatedTarget)
    if (
      nextFocusedBlockId &&
      options.keepAlivePort.hasReason({ blockId: nextFocusedBlockId, reason: 'focus' })
    ) {
      return
    }
    options.keepAlivePort.releaseReason('focus')
  }

  function pinFocusBlock(event: FocusEvent): void {
    const editor = options.getEditor()
    if (!editor || editor.isDestroyed) return
    if (!shouldUseVirtualRootBlockRenderingForOwner(editor)) return
    const blockId = readRootBlockIdFromEventTarget(event.target)
    if (!blockId) return
    options.keepAlivePort.releaseReason('focus')
    options.keepAlivePort.acquire({ blockId, reason: 'focus' })
  }

  function handleKeepAliveEvent(event: Event): void {
    const editor = options.getEditor()
    if (!editor || editor.isDestroyed) return
    if (!shouldUseVirtualRootBlockRenderingForOwner(editor)) return
    if (!isKeepAliveEvent(event)) return
    const { blockId, reason, active } = event.detail
    if (typeof blockId !== 'string' || blockId.length === 0) return
    if (!isRenderVirtualizationKeepAliveReason(reason)) return
    if (active) options.keepAlivePort.acquire({ blockId, reason })
    else options.keepAlivePort.release({ blockId, reason })
  }

  function preHydrateKeyboardTarget(event: KeyboardEvent): void {
    const editor = options.getEditor()
    if (!editor || editor.isDestroyed) return
    if (!shouldUseVirtualRootBlockRenderingForOwner(editor)) return
    hydrateKeyboardTargetRootBlock(editor, event)
    options.scheduleRefresh({ type: 'keyboard' })
  }

  function scheduleFileRefresh(): void {
    options.scheduleRefresh({ type: 'content-loaded', source: 'file' })
  }

  function schedulePendingRefresh(): void {
    options.scheduleRefresh({ type: 'content-loaded', source: 'pending-revisions' })
  }

  function cleanup(): void {
    const dom = installedEditorDom
    if (dom) {
      dom.removeEventListener('compositionstart', pinSelectionBlockForComposition)
      dom.removeEventListener('compositionend', unpinCompositionBlock)
      dom.removeEventListener('compositioncancel', unpinCompositionBlock)
      dom.removeEventListener('pointerdown', pinPointerBlock)
      dom.removeEventListener('focusin', pinFocusBlock)
      dom.removeEventListener('focusout', unpinFocusBlock)
      dom.removeEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, handleKeepAliveEvent)
      dom.removeEventListener('keydown', preHydrateKeyboardTarget, { capture: true })
    }
    installedEventBus?.off?.('file-content-loaded', scheduleFileRefresh)
    installedEventBus?.off?.('pending-revisions-loaded', schedulePendingRefresh)
    installedSelectionEditor?.off?.('selectionUpdate', syncSelectionKeepAlive)
    installedEventBus = null
    installedSelectionEditor = null
    installedEditorDom = null
    releaseSelectionLease()
    unpinPointerBlock()
  }

  function install(): void {
    const editor = options.getEditor()
    const dom = editor?.view?.dom
    if (!editor || editor.isDestroyed || !dom) return
    if (installedEditorDom === dom) return
    cleanup()
    installedEditorDom = dom

    dom.addEventListener('compositionstart', pinSelectionBlockForComposition)
    dom.addEventListener('compositionend', unpinCompositionBlock)
    dom.addEventListener('compositioncancel', unpinCompositionBlock)
    dom.addEventListener('pointerdown', pinPointerBlock)
    dom.addEventListener('focusin', pinFocusBlock)
    dom.addEventListener('focusout', unpinFocusBlock)
    dom.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, handleKeepAliveEvent)
    dom.addEventListener('keydown', preHydrateKeyboardTarget, { capture: true })

    const eventBus = editor.eventBus
    eventBus?.on?.('file-content-loaded', scheduleFileRefresh)
    eventBus?.on?.('pending-revisions-loaded', schedulePendingRefresh)
    installedEventBus = eventBus ?? null

    editor.on?.('selectionUpdate', syncSelectionKeepAlive)
    installedSelectionEditor = editor
  }

  return { install, cleanup, syncSelectionKeepAlive }
}
