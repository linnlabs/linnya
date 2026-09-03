/**
 * @file MindMap 闪烁排查日志开关
 *
 * 中文说明：
 * - 这是一个“纯调试”工具：通过全局开关控制日志输出（使用 globalThis，避免不同上下文读不到）
 * - 目标是定位“Enter 新建兄弟节点仍然闪一下”的根因（视口/连线/选中/编辑器等）
 * - 默认关闭，避免污染生产日志
 *
 * 使用方式（控制台）：
 * - 开启：`globalThis.__MM_FLICKER_DEBUG__ = true` 或 `globalThis.__setMindMapFlickerDebug(true)`
 * - 关闭：`globalThis.__MM_FLICKER_DEBUG__ = false` 或 `globalThis.__setMindMapFlickerDebug(false)`
 */

type FlickerDebugGlobal = typeof globalThis & {
  __MM_FLICKER_DEBUG__?: boolean
  __setMindMapFlickerDebug?: (enabled: boolean) => void
}

function getDebugGlobal(): FlickerDebugGlobal | null {
  if (typeof globalThis === 'undefined') return null
  return globalThis as FlickerDebugGlobal
}

export function isMindMapFlickerDebugEnabled(): boolean {
  const g = getDebugGlobal()
  return g?.__MM_FLICKER_DEBUG__ === true
}

export function setMindMapFlickerDebug(enabled: boolean): void {
  const g = getDebugGlobal()
  if (!g) return
  g.__MM_FLICKER_DEBUG__ = enabled
  // 中文说明：这里刻意不走 flickerLog，避免“开启日志还需要先开日志”的循环。
  // eslint-disable-next-line no-console
  console.log('[MindMapFlicker] debug', enabled ? 'ON' : 'OFF')
}

export function flickerLog(message: string, data?: Record<string, unknown>): void {
  if (!isMindMapFlickerDebugEnabled()) return
  if (data) {
    // eslint-disable-next-line no-console
    console.log(`[MindMapFlicker] ${message}`, data)
    return
  }
  // eslint-disable-next-line no-console
  console.log(`[MindMapFlicker] ${message}`)
}

// 暴露到 globalThis（方便无侵入开启/关闭）
if (typeof globalThis !== 'undefined') {
  const g = globalThis as FlickerDebugGlobal
  g.__setMindMapFlickerDebug = setMindMapFlickerDebug
}

