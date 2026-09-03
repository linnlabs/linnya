import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { shouldUseRootBlockShellForOwner, getFlag } from '../../../../ui/services/editorFeatureFlags'
import { findSelectionRootBlockId } from '../../../RenderVirtualization/state/renderVirtualizationPlugin'
import { useRevisionStore, type RevisionStore } from '../../store/useRevisionStore'
import {
  collectRevisionOverlayRootBlocks,
  readRootBlockIdFromEventTarget,
} from './revisionOverlayDom'
import {
  buildRevisionOverlayItems,
} from './revisionOverlayModel'
import { readRevisionToolbarBlockIds } from '../../functions/readRevisionToolbarBlockIds'
import { publishRevisionToolbarBlockIds } from '../../runtime/revisionToolbarRuntimeState'
import type { RevisionOverlayItem } from './revisionOverlayTypes'

interface EditorEventBusLike {
  on?: (eventName: string, listener: () => void) => void
  off?: (eventName: string, listener: () => void) => void
}

type EditorWithOptionalEventBus = Editor & {
  eventBus?: EditorEventBusLike
}

export interface UseRevisionOverlayLayerOptions {
  editor: Ref<EditorWithOptionalEventBus | null>
  overlayRoot: Ref<HTMLElement | null>
}

export interface UseRevisionOverlayLayerReturn {
  items: Ref<RevisionOverlayItem[]>
  isEnabled: Ref<boolean>
  handleAcceptAll: (blockId: string) => Promise<void>
  handleRejectAll: (blockId: string) => Promise<void>
  handleToolbarMouseEnter: (blockId: string) => void
  handleToolbarMouseLeave: (blockId: string) => void
}

function shouldRunRevisionOverlay(editor: Editor | null): boolean {
  return (
    shouldUseRootBlockShellForOwner(editor) &&
    getFlag('blockChromeLayerEnabled') &&
    getFlag('revisionOverlayEnabled')
  )
}

function resolveScrollRoot(editor: Editor | null): HTMLElement | null {
  const dom = editor?.view?.dom
  const scrollRoot = dom?.closest('.editor-shell')
  return scrollRoot instanceof HTMLElement ? scrollRoot : null
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function logRevisionOverlayStage(stage: string, metrics: readonly string[]): void {
  if (!getFlag('renderVirtualizationDebugLogging')) return
  console.info(`[RevisionOverlay] ${stage} ${metrics.join(' ')}`)
}

function collectForcedOverlayBlockIds(
  hoveredBlockId: string | null,
  toolbarHoverBlockId: string | null,
  selectionBlockId: string | null
): string[] {
  const blockIds = [hoveredBlockId, toolbarHoverBlockId, selectionBlockId]
  const result: string[] = []
  const seen = new Set<string>()

  for (const blockId of blockIds) {
    if (!blockId || seen.has(blockId)) continue
    seen.add(blockId)
    result.push(blockId)
  }

  return result
}

export function useRevisionOverlayLayer(
  options: UseRevisionOverlayLayerOptions
): UseRevisionOverlayLayerReturn {
  const items = ref<RevisionOverlayItem[]>([])
  const isEnabled = ref(false)
  const hoveredBlockId = ref<string | null>(null)
  const toolbarHoverBlockId = ref<string | null>(null)
  let refreshRaf: number | null = null

  const revisionStore = computed<RevisionStore | null>(() => {
    const editor = options.editor.value
    return editor ? useRevisionStore(editor) : null
  })

  function scheduleRefresh(): void {
    logRevisionOverlayStage('schedule', [
      `framePending=${refreshRaf !== null}`,
      `items=${items.value.length}`,
    ])
    if (refreshRaf !== null) return
    refreshRaf = requestAnimationFrame(refreshNow)
  }

  function refreshNow(): void {
    const startedAt = nowMs()
    logRevisionOverlayStage('refresh:start', [
      `itemsBefore=${items.value.length}`,
    ])
    refreshRaf = null
    const editor = options.editor.value
    const store = revisionStore.value
    const overlayRoot = options.overlayRoot.value

    isEnabled.value = shouldRunRevisionOverlay(editor)
    if (!isEnabled.value || !editor || editor.isDestroyed || !store || !overlayRoot) {
      items.value = []
      publishRevisionToolbarBlockIds([])
      logRevisionOverlayStage('refresh:end', [
        'reason=disabled',
        `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
      ])
      return
    }

    // 中文说明：没有 pending 时，overlay 没有任何 UI 可画，必须在 DOM 几何读取前返回。
    // 万行文档首开最怕的就是“为了确认没东西可画，先同步量完整个文档”。
    if (
      store.canonicalPendingBlockCount.value <= 0 &&
      store.activeRevisionCount.value <= 0
    ) {
      items.value = []
      publishRevisionToolbarBlockIds([])
      logRevisionOverlayStage('refresh:end', [
        'reason=no-revision-state',
        `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
      ])
      return
    }

    const selectionBlockId = findSelectionRootBlockId(editor.state)
    const forcedBlockIds = collectForcedOverlayBlockIds(
      hoveredBlockId.value,
      toolbarHoverBlockId.value,
      selectionBlockId
    )
    if (forcedBlockIds.length === 0) {
      items.value = []
      publishRevisionToolbarBlockIds([])
      logRevisionOverlayStage('refresh:end', [
        'reason=no-forced-blocks',
        `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
      ])
      return
    }

    const blocks = collectRevisionOverlayRootBlocks({
      editorRoot: editor.view.dom,
      overlayRoot,
      scrollRoot: resolveScrollRoot(editor),
      // 中文说明：pending header 已经迁移到 Shell NodeView 的文档流 slot。
      // overlay 只显示 hover/selection 的浮动工具栏，因此这里只测量 1-3 个被强制关注的块。
      includeBlockIds: forcedBlockIds,
    })

    const nextItems = buildRevisionOverlayItems({
      blocks,
      reader: store,
      hoveredBlockId: hoveredBlockId.value,
      toolbarHoverBlockId: toolbarHoverBlockId.value,
      selectionBlockId,
    })
    // 中文说明：pending header 已迁移到 RootBlockShellView 的文档流 slot。
    // overlay 只保留悬浮工具栏，因此这里不再为每个可见 pending 块创建 Vue item。
    items.value = nextItems.filter((item) => item.showToolbar)
    publishRevisionToolbarBlockIds(readRevisionToolbarBlockIds(items.value))
    logRevisionOverlayStage('refresh:end', [
      'reason=completed',
      `forced=${forcedBlockIds.length}`,
      `blocks=${blocks.length}`,
      `items=${items.value.length}`,
      `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
    ])
  }

  let leaveTimeout: ReturnType<typeof setTimeout> | null = null

  function handlePointerMove(event: PointerEvent): void {
    if (leaveTimeout !== null) {
      clearTimeout(leaveTimeout)
      leaveTimeout = null
    }
    const nextBlockId = readRootBlockIdFromEventTarget(event.target)
    if (nextBlockId === hoveredBlockId.value) return
    hoveredBlockId.value = nextBlockId
    scheduleRefresh()
  }

  function handlePointerLeave(): void {
    if (hoveredBlockId.value === null) return
    if (leaveTimeout !== null) clearTimeout(leaveTimeout)
    leaveTimeout = setTimeout(() => {
      leaveTimeout = null
      hoveredBlockId.value = null
      scheduleRefresh()
    }, 150)
  }

  function installEditorListeners(editor: EditorWithOptionalEventBus): () => void {
    const scrollRoot = resolveScrollRoot(editor)
    const schedule = () => scheduleRefresh()

    editor.view.dom.addEventListener('pointermove', handlePointerMove)
    editor.view.dom.addEventListener('pointerleave', handlePointerLeave)
    scrollRoot?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    editor.on('update', schedule)
    editor.on('selectionUpdate', schedule)
    editor.eventBus?.on?.('file-content-loaded', schedule)
    editor.eventBus?.on?.('pending-revisions-loaded', schedule)

    return () => {
      editor.view.dom.removeEventListener('pointermove', handlePointerMove)
      editor.view.dom.removeEventListener('pointerleave', handlePointerLeave)
      scrollRoot?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      editor.off('update', schedule)
      editor.off('selectionUpdate', schedule)
      editor.eventBus?.off?.('file-content-loaded', schedule)
      editor.eventBus?.off?.('pending-revisions-loaded', schedule)
    }
  }

  watch(
    () => options.editor.value,
    (editor, _previous, onCleanup) => {
      hoveredBlockId.value = null
      toolbarHoverBlockId.value = null

      if (!editor || editor.isDestroyed) {
        items.value = []
        publishRevisionToolbarBlockIds([])
        return
      }

      const cleanup = installEditorListeners(editor)
      onCleanup(cleanup)
      scheduleRefresh()
    },
    { immediate: true }
  )

  watch(
    [
      () => revisionStore.value?.canonicalPendingBlockCount.value ?? 0,
      () => revisionStore.value?.activeRevisionCount.value ?? 0,
      () => revisionStore.value?.canonicalPendingStats.value.insertCount ?? 0,
      () => revisionStore.value?.canonicalPendingStats.value.deleteCount ?? 0,
    ],
    () => scheduleRefresh()
  )

  onBeforeUnmount(() => {
    if (refreshRaf !== null) {
      cancelAnimationFrame(refreshRaf)
      refreshRaf = null
    }
    publishRevisionToolbarBlockIds([])
  })

  async function handleAcceptAll(blockId: string): Promise<void> {
    await revisionStore.value?.acceptAllRevisions(blockId)
    scheduleRefresh()
  }

  async function handleRejectAll(blockId: string): Promise<void> {
    await revisionStore.value?.rejectAllRevisions(blockId)
    scheduleRefresh()
  }

  function handleToolbarMouseEnter(blockId: string): void {
    toolbarHoverBlockId.value = blockId
    scheduleRefresh()
  }

  function handleToolbarMouseLeave(blockId: string): void {
    if (toolbarHoverBlockId.value !== blockId) return
    toolbarHoverBlockId.value = null
    scheduleRefresh()
  }

  return {
    items,
    isEnabled,
    handleAcceptAll,
    handleRejectAll,
    handleToolbarMouseEnter,
    handleToolbarMouseLeave,
  }
}
