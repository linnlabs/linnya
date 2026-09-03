/**
 * useAiWritingVirtualizationKeepAlive.ts
 *
 * AI Writing Prompt 与 RootBlock 渲染虚拟化之间的保活桥。
 *
 * 中文说明：
 * - AiWriting 通过 Teleport 渲染到 body，不在目标 rootBlock DOM 子树里；
 * - 因此 prompt 打开期间不能依赖 pointer/focus 冒泡保活目标块；
 * - 本 composable 只声明“目标 blockId 因 ai-writing 需要保活”，具体 pin/unpin 仍由 EditorContext bridge 处理。
 */

import { getCurrentInstance, inject, onBeforeUnmount, watch, type Ref } from 'vue'
import {
  applyRenderVirtualizationKeepAliveCommand,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  type RenderVirtualizationKeepAlivePort,
} from '../../RenderVirtualization'

export interface AiWritingVirtualizationEditor {
  isDestroyed?: boolean
  view?: {
    dom?: EventTarget | null
  } | null
}

export interface UseAiWritingVirtualizationKeepAliveOptions {
  editor: Ref<AiWritingVirtualizationEditor | null | undefined>
  isVisible: Ref<boolean>
  targetBlockId: Ref<string | null | undefined>
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
}

export interface UseAiWritingVirtualizationKeepAliveReturn {
  release: () => void
}

export function useAiWritingVirtualizationKeepAlive(
  options: UseAiWritingVirtualizationKeepAliveOptions
): UseAiWritingVirtualizationKeepAliveReturn {
  let pinnedBlockId: string | null = null
  let activeDispatchTarget: EventTarget | null = null
  const injectedKeepAlivePort = getCurrentInstance()
    ? inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null)
    : null

  function readEditorDom(): EventTarget | null {
    const editor = options.editor.value
    if (!editor || editor.isDestroyed) return null
    return editor.view?.dom ?? null
  }

  function readTargetBlockId(): string | null {
    const blockId = options.targetBlockId.value
    return typeof blockId === 'string' && blockId.length > 0 ? blockId : null
  }

  function dispatchAiWritingKeepAlive(
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
        reason: 'ai-writing',
      },
      active,
    })
  }

  function releasePinnedBlock(target: EventTarget | null = activeDispatchTarget): void {
    if (!pinnedBlockId) return

    dispatchAiWritingKeepAlive(target, pinnedBlockId, false)
    pinnedBlockId = null
  }

  function refreshDispatchTarget(): EventTarget | null {
    const nextTarget = readEditorDom()
    if (nextTarget === activeDispatchTarget) return activeDispatchTarget

    // 中文说明：切换文档或 editor DOM 时，必须先向旧目标成对释放，避免旧 controller 残留 pin。
    releasePinnedBlock(activeDispatchTarget)
    activeDispatchTarget = nextTarget
    return activeDispatchTarget
  }

  function syncKeepAlive(): void {
    const target = refreshDispatchTarget()
    const nextBlockId = options.isVisible.value ? readTargetBlockId() : null

    if (pinnedBlockId && pinnedBlockId !== nextBlockId) {
      releasePinnedBlock(target)
    }

    if (!nextBlockId || pinnedBlockId === nextBlockId) return

    if (dispatchAiWritingKeepAlive(target, nextBlockId, true)) {
      pinnedBlockId = nextBlockId
    }
  }

  const stop = watch(
    [
      () => options.editor.value,
      () => options.isVisible.value,
      () => options.targetBlockId.value,
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
