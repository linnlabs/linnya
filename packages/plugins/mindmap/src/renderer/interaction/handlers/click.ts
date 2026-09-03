import type { Topic } from '../../domain/types/dom'
import type { MindMapInstance } from '../../domain/types'
import { isTopic } from '../../shared/utils'
import { routeClickToIntent } from '../intents/intentRouter'
import { IntentDispatcher } from '../intents/intentDispatcher'

/**
 * click handler（拆分自 mouseHandlers.ts）
 *
 * 中文说明（Phase 2 重构）：
 * - 使用 IntentRouter 将 click 事件转换为 Intent
 * - 使用 IntentDispatcher 统一处理副作用
 * - 保留 Selection 引擎对节点点击的处理
 *
 * 处理的场景：
 * - Expander 点击：toggleExpand / expandAll
 * - SVG label/容器点击：选中 arrow/summary
 * - 多选时点击节点：选中单个（仍由 mind.selectNode 处理）
 */
export function createClickHandler(mind: MindMapInstance): (e: MouseEvent) => void {
  const { dragMoveHelper } = mind

  // 创建 IntentDispatcher（如果外部已安装则复用）
  // 中文说明：优先使用外部安装的 dispatcher，避免重复创建
  let dispatcher: IntentDispatcher | null = null
  const getDispatcher = () => {
    if (dispatcher) return dispatcher
    // 检查是否由外部安装了 dispatcher（通过 useMindmapHotkeys）
    const externalDispatcher = (mind as { intentDispatcher?: IntentDispatcher }).intentDispatcher
    if (externalDispatcher) {
      dispatcher = externalDispatcher
    } else {
      // 创建一个临时的 dispatcher
      dispatcher = new IntentDispatcher(mind)
    }
    return dispatcher
  }

  return (e: MouseEvent) => {
    // Only handle primary button clicks
    if (e.button !== 0) return

    // 拖拽状态清理
    if (mind.helper1?.moved) {
      mind.helper1.clear()
      return
    }
    if (mind.helper2?.moved) {
      mind.helper2.clear()
      return
    }
    if (dragMoveHelper.moved) {
      dragMoveHelper.clear()
      return
    }

    // 尝试通过 Intent 系统处理
    const routeResult = routeClickToIntent(e, mind)
    if (routeResult.matched) {
      const result = getDispatcher().dispatch(routeResult.intent)
      if (result.handled) {
        return
      }
      // 如果 Intent 未处理，继续走原有逻辑
    }

    // 多选场景下点击节点：选中单个
    // 中文说明：这里保留原有逻辑，因为 Selection 引擎不处理"多选时点击单个"的场景
    const target = e.target as HTMLElement
    if (target.tagName === 'MM-TOPIC' && mind.currentNodes.length > 1) {
      mind.selectNode(target as Topic)
      return
    }

    // 单选语义（关键修复）：
    // - 无 Ctrl/Cmd 时：点击任意节点应切换为“单选”，清除之前选中
    // - Ctrl/Cmd：交给 selection 引擎处理（多选/切换）
    //
    // 根因：
    // - 当前 selection adapter 对拖拽框选有 suppress 规则，导致“单击选中”在部分路径下不会触发清理旧选中，
    //   进而出现“点击别的节点旧选中不取消”的体验问题。
    const topicEl = ((): Topic | null => {
      if (!target) return null
      if (target.tagName === 'MM-TOPIC') return target as unknown as Topic
      const closest = target.closest('mm-topic')
      return closest && closest.tagName === 'MM-TOPIC' ? (closest as unknown as Topic) : null
    })()

    if (topicEl) {
      if (!e.ctrlKey && !e.metaKey) {
        mind.selectNode(topicEl)
      }
      return
    }
  }
}
