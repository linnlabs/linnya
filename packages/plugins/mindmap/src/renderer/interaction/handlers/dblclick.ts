import type { MindMapInstance } from '../../domain/types'
import { routeDblClickToIntent } from '../intents/intentRouter'
import { IntentDispatcher } from '../intents/intentDispatcher'

/**
 * dblclick handler（拆分自 mouseHandlers.ts）
 *
 * 中文说明（Phase 2 重构）：
 * - 使用 IntentRouter 将 dblclick 事件转换为 Intent
 * - 使用 IntentDispatcher 统一处理副作用
 *
 * 处理的场景：
 * - Topic 双击：开始编辑
 * - Arrow/Summary label 双击：编辑标签
 */
export function createDblClickHandler(mind: MindMapInstance): (e: MouseEvent) => void {
  // 创建 IntentDispatcher（如果外部已安装则复用）
  let dispatcher: IntentDispatcher | null = null
  const getDispatcher = () => {
    if (dispatcher) return dispatcher
    const externalDispatcher = (mind as { intentDispatcher?: IntentDispatcher }).intentDispatcher
    if (externalDispatcher) {
      dispatcher = externalDispatcher
    } else {
      dispatcher = new IntentDispatcher(mind)
    }
    return dispatcher
  }

  return (e: MouseEvent) => {
    if (!mind.editable) return

    // 通过 Intent 系统处理
    const routeResult = routeDblClickToIntent(e, mind)
    if (routeResult.matched) {
      const result = getDispatcher().dispatch(routeResult.intent)
      if (result.handled) {
        return
      }
    }

    // 如果 Intent 未处理，不做额外处理
    // 中文说明：Phase 2 目标是让所有双击都走 Intent，未匹配的情况应该是 bug
  }
}

/**
 * Touch 双击识别器
 *
 * 中文说明：
 * - 用于触摸设备的双击识别
 * - tap 间隔 < 300ms 视为双击
 */
export function createTouchDblClickHandler(
  handleDblClick: (e: MouseEvent) => void
): (e: PointerEvent) => void {
  let lastTap = 0
  return (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return
    const currentTime = Date.now()
    const tapLength = currentTime - lastTap
    if (tapLength < 300 && tapLength > 0) {
      handleDblClick(e as unknown as MouseEvent)
    }
    lastTap = currentTime
  }
}
