/**
 * @file chartReadingSessions.ts
 * @description 阅读状态的会话生命周期入口：Editor 扩展用它创建会话身份，并在关闭文档或删除块时清理。
 *
 * 扩展只依赖这里的三个函数，不接触阅读 store 的内部结构。
 */

import { useChartReadingStore } from '../store/chartReadingStore'

let sequence = 0

/** 每个 Editor 实例一个会话身份；同一文档在两个编辑器中互不共享阅读状态。 */
export function createChartReadingSessionId(): string {
  sequence += 1
  return `chart-reading-session-${sequence}`
}

export function disposeChartReadingSession(sessionId: string): void {
  useChartReadingStore().dropEditorSession(sessionId)
}

export function disposeChartReadingBlock(sessionId: string, blockId: string): void {
  useChartReadingStore().dropBlock(sessionId, blockId)
}
