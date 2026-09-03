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
