import type { Topic } from '../../domain/types/dom'
import type { MindMapInstance } from '../../domain/types'
import { isTopic } from '../../shared/utils'

/**
 * contextmenu handler（拆分自 mouseHandlers.ts）
 *
 * 中文说明：
 * - 右键菜单只发纯 payload 事件：`ui:openContextMenu`
 * - 这里依旧会 selectNode(topic) 以保持“右键=选中并弹菜单”的 UX
 */
export function createContextMenuHandler(mind: MindMapInstance): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    e.preventDefault()
    if (e.button !== 2) return
    if (!mind.editable) return

    const target = e.target as HTMLElement

    const topicEl = isTopic(target)
      ? (target as Topic)
      : ((target.closest('mm-topic') as Topic | null) ?? null)

    if (topicEl) {
      mind.selectNode(topicEl)
      // 旧逻辑的透传字段已不再需要（菜单已改为纯 payload）
    }

    if (mind.dragMoveHelper.moved) return

    mind.bus.fire('ui:openContextMenu', {
      nodeId: topicEl?.nodeObj?.id,
      x: e.clientX,
      y: e.clientY,
      trigger: 'mouse',
    })
  }
}

