import type { MindMapInstance } from '../../domain/types'

/**
 * keyboard handlers（拆分自 mouseHandlers.ts）
 *
 * 中文说明：
 * - 目前只负责空格键状态（用于 pan/移动模式）
 * - 未来可以把更多快捷键路由放在这里（但不要和 editor 的快捷键耦合）
 */
export function createKeyDownHandler(mind: MindMapInstance): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (e.code === 'Space') {
      mind.spacePressed = true
      mind.container.classList.add('space-pressed')
    }
  }
}

export function createKeyUpHandler(mind: MindMapInstance): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      mind.spacePressed = false
      mind.container.classList.remove('space-pressed')
    }
  }
}

