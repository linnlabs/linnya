/**
 * @file chartReadingStore.ts
 * @description 阅读状态的会话存储：按 Editor 会话、块身份和展示用途隔离。
 *
 * store 只同步持有状态并暴露 action，规则在 functions/ 中；ECharts 实例不进入这里。
 * 实例可以因离屏而释放，阅读状态依旧保留，再入屏时恢复；关闭文档或删除块时清理。
 */

import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import { DEFAULT_CHART_READING_STATE, type ChartReadingEntry, type ChartReadingKey, type ChartReadingState } from '../definitions/chartReadingState'

export function chartReadingKeyOf(key: ChartReadingKey): string {
  return `${key.editorSessionId}\u0000${key.blockId}\u0000${key.variant}`
}

export const useChartReadingStore = defineStore('editor-chart-reading', () => {
  const sessions = shallowRef(new Map<string, ChartReadingEntry>())

  function readEntry(key: ChartReadingKey): ChartReadingEntry | undefined {
    return sessions.value.get(chartReadingKeyOf(key))
  }

  function read(key: ChartReadingKey): ChartReadingState {
    return readEntry(key)?.state ?? DEFAULT_CHART_READING_STATE
  }

  function write(key: ChartReadingKey, state: ChartReadingState, semanticKey: string): void {
    const id = chartReadingKeyOf(key)
    if (state === DEFAULT_CHART_READING_STATE) sessions.value.delete(id)
    else sessions.value.set(id, { state, semanticKey })
    triggerRef(sessions)
  }

  /** 删除块：该块所有用途的状态一并清理。 */
  function dropBlock(editorSessionId: string, blockId: string): void {
    let changed = false
    for (const variant of ['document', 'proposed', 'baseline'] as const) {
      changed = sessions.value.delete(chartReadingKeyOf({ editorSessionId, blockId, variant })) || changed
    }
    if (changed) triggerRef(sessions)
  }

  /** 关闭文档：清理该 Editor 会话的全部阅读状态。 */
  function dropEditorSession(editorSessionId: string): void {
    const prefix = `${editorSessionId}\u0000`
    let changed = false
    for (const id of [...sessions.value.keys()]) {
      if (id.startsWith(prefix)) changed = sessions.value.delete(id) || changed
    }
    if (changed) triggerRef(sessions)
  }

  function size(): number {
    return sessions.value.size
  }

  return { sessions, read, readEntry, write, dropBlock, dropEditorSession, size }
})
