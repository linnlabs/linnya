/**
 * useAnnotationVirtualizationKeepAlive.ts
 *
 * 批注面板与 rootBlock 渲染虚拟化之间的低耦合保活桥。
 *
 * 中文说明：
 * - AnnotationPanel 被 Teleport 到 annotation-layer，不在 rootBlock DOM 子树里；
 * - 因此批注交互不能依赖事件从面板冒泡到 editor；
 * - 本 composable 只把“哪些 blockId 因批注交互需要保活”声明到 editor.view.dom；
 * - 具体 pin/unpin 仍由 RenderVirtualization bridge + KeepAliveRegistry 统一执行。
 */

import { getCurrentInstance, inject, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import {
  applyRenderVirtualizationKeepAliveCommand,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  type RenderVirtualizationKeepAlivePort,
} from '../../RenderVirtualization'

export interface AnnotationKeepAlivePanel {
  id?: string | null
  blockId?: string | null
  state?: string | null
}

export interface AnnotationVirtualizationEditor {
  isDestroyed?: boolean
  view?: {
    dom?: EventTarget | null
  } | null
}

export interface UseAnnotationVirtualizationKeepAliveOptions {
  editor: Ref<AnnotationVirtualizationEditor | null | undefined>
  annotations: Ref<AnnotationKeepAlivePanel[]>
  activeStates: readonly string[]
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
}

export interface UseAnnotationVirtualizationKeepAliveReturn {
  setPanelHoverState: (panelId: string | null | undefined, hovered: boolean) => void
  releaseAll: () => void
}

export function useAnnotationVirtualizationKeepAlive(
  options: UseAnnotationVirtualizationKeepAliveOptions
): UseAnnotationVirtualizationKeepAliveReturn {
  const hoveredAnnotationIds = ref(new Set<string>())
  const pinnedBlockIds = new Set<string>()
  const activeStateSet = new Set(options.activeStates)
  let activeDispatchTarget: EventTarget | null = null
  const injectedKeepAlivePort = getCurrentInstance()
    ? inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null)
    : null

  function readEditorDom(): EventTarget | null {
    const editor = options.editor.value
    if (!editor || editor.isDestroyed) return null
    return editor.view?.dom ?? null
  }

  function dispatchAnnotationKeepAlive(
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
        reason: 'annotation',
      },
      active,
    })
  }

  function releasePinnedBlocks(target: EventTarget | null): void {
    pinnedBlockIds.forEach((blockId) => {
      dispatchAnnotationKeepAlive(target, blockId, false)
    })
    pinnedBlockIds.clear()
  }

  function refreshDispatchTarget(): EventTarget | null {
    const nextTarget = readEditorDom()
    if (nextTarget === activeDispatchTarget) return activeDispatchTarget

    // 中文说明：文档/Editor 切换时，先向旧 editor DOM 成对释放，避免旧 controller 残留 annotation pin。
    releasePinnedBlocks(activeDispatchTarget)
    activeDispatchTarget = nextTarget
    return activeDispatchTarget
  }

  function collectKeepAliveBlockIds(): string[] {
    const blockIds = new Set<string>()

    options.annotations.value.forEach((panel) => {
      const blockId = panel.blockId
      if (!blockId) return

      const panelId = panel.id
      const isHovered = !!panelId && hoveredAnnotationIds.value.has(panelId)
      const isEditingLike = !!panel.state && activeStateSet.has(panel.state)

      if (isHovered || isEditingLike) {
        blockIds.add(blockId)
      }
    })

    return Array.from(blockIds)
  }

  function syncAnnotationKeepAlive(): void {
    const target = refreshDispatchTarget()
    if (!target) return

    const nextBlockIds = new Set(collectKeepAliveBlockIds())

    pinnedBlockIds.forEach((blockId) => {
      if (!nextBlockIds.has(blockId)) {
        dispatchAnnotationKeepAlive(target, blockId, false)
        pinnedBlockIds.delete(blockId)
      }
    })

    nextBlockIds.forEach((blockId) => {
      if (!pinnedBlockIds.has(blockId) && dispatchAnnotationKeepAlive(target, blockId, true)) {
        pinnedBlockIds.add(blockId)
      }
    })
  }

  function setPanelHoverState(panelId: string | null | undefined, hovered: boolean): void {
    if (!panelId) return

    const nextHoveredIds = new Set(hoveredAnnotationIds.value)
    if (hovered) nextHoveredIds.add(panelId)
    else nextHoveredIds.delete(panelId)
    hoveredAnnotationIds.value = nextHoveredIds
  }

  function releaseAll(): void {
    releasePinnedBlocks(activeDispatchTarget)
    hoveredAnnotationIds.value = new Set()
  }

  watch(
    [options.annotations, hoveredAnnotationIds, options.editor],
    () => {
      syncAnnotationKeepAlive()
    },
    { deep: true, immediate: true }
  )

  onBeforeUnmount(() => {
    releaseAll()
  })

  return {
    setPanelHoverState,
    releaseAll,
  }
}
