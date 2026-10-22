/**
 * @file useChartEditDraft.ts
 * @description 源码编辑面板的草稿流程：输入即校验，预览防抖，保存只交出有效规格。
 *
 * 校验每次输入都立即执行（诊断与保存按钮即时反映）；预览只跟随最近一次**有效**规格并做短防抖，
 * 半成品的 JSON 不会让图闪烁，也不会播放过渡。草稿是面板本地状态，取消即丢弃。
 */

import { computed, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import type { MarkdownChartSpec } from '@app/schemas'
import {
  evaluateChartSource,
  isChartSourceChanged,
  sourceTextOfSpec,
  type ChartSourceEvaluation,
} from '../functions/chartSourceDraft'

const PREVIEW_DEBOUNCE_MS = 220

export interface UseChartEditDraftOptions {
  readonly initialSpec: MarkdownChartSpec
  readonly currentSpec?: Readonly<Ref<MarkdownChartSpec>>
  readonly blocked?: Readonly<Ref<boolean | undefined>>
  readonly previewDebounceMs?: number
}

export function useChartEditDraft(options: UseChartEditDraftOptions) {
  const debounceMs = options.previewDebounceMs ?? PREVIEW_DEBOUNCE_MS
  const baselineText = sourceTextOfSpec(options.initialSpec)

  const sourceText = ref(baselineText)
  const evaluation = shallowRef<ChartSourceEvaluation>(evaluateChartSource(baselineText))
  const previewSpec = shallowRef<MarkdownChartSpec>(options.initialSpec)
  let previewTimer: ReturnType<typeof setTimeout> | null = null

  function cancelPreviewTimer(): void {
    if (previewTimer !== null) clearTimeout(previewTimer)
    previewTimer = null
  }

  function setSource(text: string): void {
    sourceText.value = text
    const next = evaluateChartSource(text)
    evaluation.value = next
    cancelPreviewTimer()
    if (next.kind !== 'valid') return
    previewTimer = setTimeout(() => {
      previewTimer = null
      previewSpec.value = next.spec
    }, debounceMs)
  }

  const diagnostics = computed(() => (evaluation.value.kind === 'invalid' ? evaluation.value.diagnostics : []))
  const sourceChanged = computed(() => options.blocked?.value === true
    || (options.currentSpec !== undefined && sourceTextOfSpec(options.currentSpec.value) !== baselineText))
  const canConfirm = computed(() => evaluation.value.kind === 'valid' && !sourceChanged.value)
  const changed = computed(() => isChartSourceChanged(evaluation.value, baselineText))
  /** 预览是否落后于输入：当前草稿无效，图仍显示最近一次有效规格。 */
  const previewIsStale = computed(() => evaluation.value.kind !== 'valid' && sourceText.value.trim() !== '')

  /** 草稿有效时返回规格；否则 null。同时取消尚未触发的预览更新。 */
  function confirm(): MarkdownChartSpec | null {
    cancelPreviewTimer()
    return evaluation.value.kind === 'valid' && canConfirm.value ? evaluation.value.spec : null
  }

  onBeforeUnmount(cancelPreviewTimer)

  return { sourceText, evaluation, previewSpec, diagnostics, canConfirm, sourceChanged, changed, previewIsStale, setSource, confirm }
}
