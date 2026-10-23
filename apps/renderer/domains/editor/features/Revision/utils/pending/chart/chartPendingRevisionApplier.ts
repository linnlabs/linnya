import type { Editor } from '@tiptap/core'
import { applyAtomicPendingItems } from '../atomicPendingRevisionApplier'
import { applyChartPendingPlanToTr } from './chartPendingProjection'
import type { ChartPendingItem } from './chartPendingPlan'

export function applyChartPendingItems(editor: Editor, items: readonly ChartPendingItem[]) {
  return applyAtomicPendingItems(editor, items, applyChartPendingPlanToTr)
}
