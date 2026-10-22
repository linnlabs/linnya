/**
 * @file useChartRevisionView.ts
 * @description 图表块 NodeView 的修订视图：把 Revision 的 canonical 会话与投影账本整理成显示模型。
 *
 * Revision 是 Pending 的唯一 owner：这里只读它的公开状态，不写入、不提交。
 * 会话以 rootBlock id 为键；原块来自投影账本，只用于展示对照。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { MarkdownChartSpecSchema, type MarkdownChartSpec } from '@app/schemas'
import { useRevisionStore } from '../../../features/Revision/useRevisionStore'
import { deriveChartRevisionView, type ChartRevisionView } from '../functions/chartRevisionView'

export interface UseChartRevisionViewOptions {
  readonly editor: Editor
  /** 图表所在 rootBlock 的 id；节点已脱离文档时为 null。 */
  readonly rootBlockId: Ref<string | null>
}

export interface UseChartRevisionViewReturn {
  readonly revision: ComputedRef<ChartRevisionView>
  /** 账本中的原图表规格；原内容不是图表或不可用时为 null。 */
  readonly baselineSpec: ComputedRef<MarkdownChartSpec | null>
  readonly showingBaseline: Ref<boolean>
  readonly toggleBaseline: () => void
}

export function useChartRevisionView(options: UseChartRevisionViewOptions): UseChartRevisionViewReturn {
  const store = useRevisionStore(options.editor)
  const showingBaseline = ref(false)

  const session = computed(() => {
    const id = options.rootBlockId.value
    return id ? store.getCanonicalSession(id) : null
  })

  // 账本是普通 Map：依赖 session.projection，使“投影完成”这一响应式变化触发重算。
  const baselineContent = computed(() => {
    const id = options.rootBlockId.value
    void session.value?.projection
    return id ? store.readProjectionBaseline(id)?.firstChild ?? null : null
  })

  const baselineSpec = computed<MarkdownChartSpec | null>(() => {
    const content = baselineContent.value
    if (content?.type.name !== 'chartBlock') return null
    const parsed = MarkdownChartSpecSchema.safeParse(content.attrs['spec'])
    return parsed.success ? parsed.data : null
  })

  const revision = computed(() => deriveChartRevisionView({
    operation: session.value?.operation ?? null,
    projection: session.value?.projection ?? null,
    baselineAvailable: baselineContent.value !== null,
    baselineSpec: baselineSpec.value,
    showingBaseline: showingBaseline.value,
  }))

  return {
    revision,
    baselineSpec,
    showingBaseline,
    toggleBaseline: () => { showingBaseline.value = !showingBaseline.value },
  }
}
