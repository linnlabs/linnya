import type { MindMapInstance } from '../../domain/types'
import { shouldIgnorePan } from '../../shared/utils/interactionGate'

/**
 * pointer pan handlers（拆分自 mouseHandlers.ts）
 *
 * 中文说明：
 * - 负责画布拖拽平移（pointerdown/move/up/blur）
 * - 必须使用 InteractionGate 统一过滤，避免 addon 内部交互误触发 pan
 */
export function createPointerPanHandlers(mind: MindMapInstance): {
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onBlur: () => void
} {
  const { dragMoveHelper } = mind

  const onPointerDown = (e: PointerEvent) => {
    dragMoveHelper.moved = false

    // 支持空格/移动模式 + 左键拖拽
    const isSpaceDrag = (mind.spacePressed || mind.moveMode) && e.button === 0 && e.pointerType === 'mouse'
    const mouseMoveButton = mind.mouseSelectionButton === 0 ? 2 : 0
    const isNormalDrag = (e.button === mouseMoveButton && e.pointerType === 'mouse') || e.pointerType === 'touch'

    if (!isSpaceDrag && !isNormalDrag) return

    dragMoveHelper.x = e.clientX
    dragMoveHelper.y = e.clientY

    const target = e.target as HTMLElement
    const gateDebugEnabled = mind.bus.debug.interactionGate.isEnabled()

    const shouldIgnore = shouldIgnorePan(
      { target, event: e, boundary: mind.container },
      { debug: gateDebugEnabled }
    )

    if (isSpaceDrag || !shouldIgnore) {
      dragMoveHelper.mousedown = true
      target.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    const target = e.target as HTMLElement
    const gateDebugEnabled = mind.bus.debug.interactionGate.isEnabled()
    const shouldIgnore = shouldIgnorePan(
      { target, event: e, boundary: mind.container },
      { debug: gateDebugEnabled }
    )
    const isSpaceOrMoveMode = (mind.spacePressed || mind.moveMode) && dragMoveHelper.mousedown

    if (!shouldIgnore || isSpaceOrMoveMode) {
      const movementX = e.clientX - dragMoveHelper.x
      const movementY = e.clientY - dragMoveHelper.y
      dragMoveHelper.onMove(movementX, movementY)
    }

    dragMoveHelper.x = e.clientX
    dragMoveHelper.y = e.clientY
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!dragMoveHelper.mousedown) return
    const target = e.target as HTMLElement
    if (target.hasPointerCapture && target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId)
    }
    dragMoveHelper.clear()
  }

  const onBlur = () => {
    if (dragMoveHelper.mousedown) {
      dragMoveHelper.clear()
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onBlur }
}

