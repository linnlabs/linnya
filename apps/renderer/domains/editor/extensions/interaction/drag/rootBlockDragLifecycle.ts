/**
 * rootBlockDragLifecycle.ts
 *
 * RootBlock 拖拽手柄的 UI 生命周期边界。
 *
 * 中文说明：
 * 拖拽命令只负责“哪个块移动到哪里”，但手柄交互还需要维护一组浏览器级状态：
 * 禁止文本选择、抑制拖拽结束后的 hover 残留、挂载全局 dragover/drop listener，
 * 以及创建 / 清理 drop indicator。旧 BlockChrome 和 Host left-handle 必须复用同一套
 * 生命周期，否则 Host 迁移后会出现指示器缺失、hover 残留或拖拽结束清理不完整。
 */

import {
  addDragEventListeners,
  cleanupDropIndicator,
  createDropIndicator,
  removeDragEventListeners,
} from './DropCursorPlugin'

export interface EndRootBlockDragVisualLifecycleOptions {
  restoreHoverOnNextPointerMove?: boolean
}

export interface EndRootBlockDragInteractionOptions
  extends EndRootBlockDragVisualLifecycleOptions {
  releaseHandleSelection: () => void
}

export function beginRootBlockDragHandlePress(event: MouseEvent): boolean {
  if (event.button !== 0) return false
  document.body.style.userSelect = 'none'
  return true
}

export function endRootBlockDragHandlePress(): void {
  document.body.style.userSelect = ''
}

export function beginRootBlockDragVisualLifecycle(): void {
  document.body.setAttribute('data-suppress-handle-hover', 'true')
  addDragEventListeners()
}

export function endRootBlockDragVisualLifecycle(
  options: EndRootBlockDragVisualLifecycleOptions = {}
): void {
  endRootBlockDragHandlePress()
  removeDragEventListeners()

  if (options.restoreHoverOnNextPointerMove === false) {
    document.body.removeAttribute('data-suppress-handle-hover')
    return
  }

  const reEnableHover = () => {
    document.body.removeAttribute('data-suppress-handle-hover')
  }
  document.addEventListener('pointermove', reEnableHover, { once: true })
}

/**
 * RootBlock 拖拽交互的统一收尾边界。
 *
 * 手柄选中态由具体 Vue / Host surface 持有，但它的生命周期属于本次 drag；
 * 所以由共享边界强制释放，再清理浏览器级拖拽视觉，避免两套 surface 行为漂移。
 */
export function endRootBlockDragInteraction(
  options: EndRootBlockDragInteractionOptions
): void {
  try {
    options.releaseHandleSelection()
  } finally {
    endRootBlockDragVisualLifecycle({
      restoreHoverOnNextPointerMove: options.restoreHoverOnNextPointerMove,
    })
  }
}

export function setupRootBlockDropIndicator(): void {
  createDropIndicator()
}

export function cleanupRootBlockDropIndicator(): void {
  cleanupDropIndicator()
}

export function cleanupRootBlockDragVisualLifecycle(): void {
  endRootBlockDragVisualLifecycle({ restoreHoverOnNextPointerMove: false })
  cleanupDropIndicator()
}
