/**
 * @file chartEditingStore.ts
 * @description 图表源码编辑面板的“待打开”请求：插入图表的命令先落地节点，再请求其 NodeView 打开面板。
 *
 * store 只同步持有请求并暴露 action；谁来响应由 NodeView 通过 `consume` 决定。
 * 请求按 Editor 会话和块身份定位，同一文档在两个编辑器里打开时不会互相弹出面板。
 */

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import type { ChartEditRequest, ChartEditTarget } from '../definitions/chartEditingRequest'

export const useChartEditingStore = defineStore('editor-chart-editing', () => {
  const pending = shallowRef<ChartEditRequest | null>(null)

  function request(target: ChartEditRequest): void {
    pending.value = target
  }

  /** 请求属于该块时取走并返回它；否则不动、返回 null。 */
  function consume(target: ChartEditTarget): ChartEditRequest | null {
    const current = pending.value
    if (!current || current.editorSessionId !== target.editorSessionId || current.blockId !== target.blockId) return null
    pending.value = null
    return current
  }

  function clear(): void {
    pending.value = null
  }

  return { pending, request, consume, clear }
})
