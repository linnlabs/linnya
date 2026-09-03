import type { MindMapInstance } from '../../domain/types'
import { shouldIgnoreWheel } from '../../shared/utils/interactionGate'
import { routeWheelToIntent } from '../intents/intentRouter'
import { IntentDispatcher } from '../intents/intentDispatcher'

/**
 * wheel handler（拆分自 mouseHandlers.ts）
 *
 * 中文说明（Phase 2 重构）：
 * - 使用 IntentRouter 将 wheel 事件转换为 Intent
 * - 使用 IntentDispatcher 统一处理副作用
 * - 保留 InteractionGate 的过滤逻辑
 *
 * 处理的场景：
 * - Ctrl/Meta+wheel：缩放
 * - Shift+wheel：横向平移
 * - 普通 wheel：自由平移
 */
export function createWheelHandler(mind: MindMapInstance): (e: WheelEvent) => void {
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

  return (e: WheelEvent) => {
    // InteractionGate 过滤
    const target = e.target
    if (target instanceof Element) {
      const gateDebugEnabled = mind.bus.debug.interactionGate.isEnabled()
      const shouldIgnore = shouldIgnoreWheel(
        { target, event: e, boundary: mind.container },
        { debug: gateDebugEnabled }
      )
      if (shouldIgnore) {
        // 中文说明：
        // - wheel 来自交互区域（如 addon 的滚动容器）时，不应触发画布 move/zoom
        // - 不阻止默认行为，让浏览器原生滚动接管
        return
      }
    }

    e.stopPropagation()
    e.preventDefault()

    // 通过 Intent 系统处理
    const routeResult = routeWheelToIntent(e, mind)
    if (routeResult.matched) {
      const result = getDispatcher().dispatch(routeResult.intent)
      if (result.handled) {
        return
      }
    }

    // 如果 Intent 未处理，不做额外处理
    // 中文说明：Phase 2 目标是让所有 wheel 都走 Intent，未匹配的情况应该是 bug
  }
}
