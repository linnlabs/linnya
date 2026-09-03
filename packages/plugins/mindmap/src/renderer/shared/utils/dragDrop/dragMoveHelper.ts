import type { MindMapInstance } from '../../../domain/types/index'

export function createDragMoveHelper(mind: MindMapInstance) {
  return {
    x: 0,
    y: 0,
    moved: false, // diffrentiate click and move
    mousedown: false,
    onMove(deltaX: number, deltaY: number) {
      if (this.mousedown) {
        this.moved = true
        mind.move(deltaX, deltaY)
      }
    },
    clear() {
      this.mousedown = false
    },
  }
}

