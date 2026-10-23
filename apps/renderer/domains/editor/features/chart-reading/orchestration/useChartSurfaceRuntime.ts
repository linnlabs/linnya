/**
 * @file useChartSurfaceRuntime.ts
 * @description 一张图表在界面上的运行流程：阅读状态、主题、实例生命周期、过渡决策与复制图片。
 *
 * Vue 组件只负责绑定；规则在 functions/，ECharts 实例在 chartInstanceController 中。
 * 这里编排的是“什么时候创建/更新/释放实例”：
 * - active 为真才存在实例；离屏释放实例，阅读状态仍保留；
 * - 只有规格语义更新（可确认身份）或读者主动操作才播放短过渡，其余一律直接呈现最终结果；
 * - 主题/容器宽度变化重绘但不播放过渡。
 */

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, unref, watch, type Ref } from 'vue'
import { encodeMarkdownChartFence, serializeMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'
import { useNotificationStore } from '@/app/notification'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { DEFAULT_CHART_READING_STATE, type ChartReadingKey, type ChartReadingState } from '../definitions/chartReadingState'
import type { ChartOptionMessages } from '../definitions/chartRender'
import { baseChartTheme, type ChartThemeTokens } from '../definitions/chartTheme'
import { buildChartLegend, resolveLegendPosition } from '../functions/chartLegend'
import { plotHeightOf } from '../functions/chartLayout'
import {
  emphasisTargetsCategories,
  reconcileReadingState,
  readingSemanticKey,
  resetReadingState,
  setCategoryRange,
  setValueRanges,
  supportsCategoryRange,
  supportsSeriesFiltering,
  supportsValueRange,
  toggleEmphasis,
  toggleSeriesVisibility,
} from '../functions/chartReadingState'
import { deriveChartReadingView, resolveChartHighlight } from '../functions/chartReadingView'
import { canTransitionBetween } from '../functions/chartTransition'
import { useChartReadingStore } from '../store/chartReadingStore'
import { createChartController, type ChartController } from './chartInstanceController'
import { renderChartImagePng } from './exportChartImage'
import { chartSchemeOfTheme, observeChartTheme, readActiveChartTheme, resolveChartTheme } from './readChartTheme'

export type ChartRuntimeStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface UseChartSurfaceRuntimeOptions {
  readonly spec: Ref<MarkdownChartSpec>
  /** null：不进入会话存储（编辑预览），状态只在该组件内存在。 */
  readonly readingKey: Ref<ChartReadingKey | null>
  readonly active: Ref<boolean>
  readonly plotElement: Ref<HTMLElement | null>
  /** false：永远直接呈现最终结果（源码编辑预览、修订对照不对中间态播放动画）。 */
  readonly transitions?: Ref<boolean>
}

const MIN_WIDTH_CHANGE_PX = 4

export function useChartSurfaceRuntime(options: UseChartSurfaceRuntimeOptions) {
  const { currentLocale, editorMessage } = useEditorLocalization()
  const notifications = useNotificationStore()
  const store = useChartReadingStore()

  const localState = shallowRef<ChartReadingState>(DEFAULT_CHART_READING_STATE)
  const semanticKey = computed(() => readingSemanticKey(options.spec.value))
  const state = computed<ChartReadingState>(() => {
    const key = unref(options.readingKey)
    if (!key) return localState.value
    const entry = store.readEntry(key)
    return entry?.semanticKey === semanticKey.value ? entry.state : DEFAULT_CHART_READING_STATE
  })

  function writeState(next: ChartReadingState): void {
    const key = unref(options.readingKey)
    if (key) store.write(key, next, semanticKey.value)
    else localState.value = next
  }

  const view = computed(() => deriveChartReadingView(options.spec.value, state.value))
  const legendPosition = computed(() => resolveLegendPosition(options.spec.value))
  const status = ref<ChartRuntimeStatus>('idle')
  const themeIdentity = ref(readActiveChartTheme())
  const scheme = computed(() => chartSchemeOfTheme(themeIdentity.value))
  const reducedMotion = ref(false)
  const plotHeight = computed(() => plotHeightOf(options.spec.value))
  const canonicalText = computed(() => serializeMarkdownChartSpec(options.spec.value))

  const messages = computed<ChartOptionMessages>(() => ({
    secondaryAxis: editorMessage('editor.chart.legend.secondaryAxis'),
    shareOfWhole: editorMessage('editor.chart.message.shareOfWhole'),
    share: editorMessage('editor.chart.message.share'),
  }))

  function resolveTheme(): ChartThemeTokens {
    return resolveChartTheme(options.plotElement.value ?? document.body, scheme.value, options.spec.value.palette)
  }

  const legend = computed(() => buildChartLegend(options.spec.value, state.value, baseChartTheme(scheme.value, options.spec.value.palette)))

  // ---- 阅读状态：规格语义变化时重置，其余只收敛 ----
  watch([semanticKey, options.readingKey], () => {
    const key = options.readingKey.value
    const entry = key ? store.readEntry(key) : undefined
    // 重新入屏也要核对版本；不能让离屏期间改过的数据沿用旧筛选。
    if (key && entry && entry.semanticKey !== semanticKey.value) store.write(key, DEFAULT_CHART_READING_STATE, semanticKey.value)
  }, { immediate: true })
  watch(options.spec, (next, previous) => {
    if (!options.readingKey.value) localState.value = reconcileReadingState(previous, next, localState.value)
  })

  // ---- 实例生命周期 ----
  let controller: ChartController | null = null
  let lastRendered: { specText: string; spec: MarkdownChartSpec; state: ChartReadingState; themeIdentity: string | null; locale: string } | null = null

  let renderGeneration = 0

  function releaseInstance(): void {
    renderGeneration += 1
    controller?.dispose()
    controller = null
    lastRendered = null
    status.value = 'idle'
  }

  async function renderNow(allowTransition = true): Promise<void> {
    const generation = ++renderGeneration
    const host = options.plotElement.value
    if (!host || !options.active.value) return
    controller ??= createChartController(host)

    const spec = options.spec.value
    const readingState = state.value
    const specText = canonicalText.value
    const themeId = themeIdentity.value
    const locale = currentLocale.value
    const previous = lastRendered
    const specChanged = previous !== null && previous.specText !== specText
    const themeChanged = previous !== null && (previous.themeIdentity !== themeId || previous.locale !== locale)
    // 过渡只属于“可确认身份的数据更新”和“读者的主动操作”；主题、语言、容器变化不播放。
    const transition = allowTransition && !reducedMotion.value && options.transitions?.value !== false && previous !== null && !themeChanged && (specChanged
      ? readingSemanticKey(previous.spec) !== semanticKey.value && canTransitionBetween(previous.spec, spec)
      : previous.state !== readingState && canTransitionBetween(spec, spec))

    status.value = previous === null ? 'loading' : status.value
    const active = controller
    try {
      await active.render({
        spec,
        state: readingState,
        theme: resolveTheme(),
        locale,
        messages: messages.value,
        transition,
      })
      if (generation !== renderGeneration || controller !== active || active.isDisposed) return
      lastRendered = { specText, spec, state: readingState, themeIdentity: themeId, locale }
      status.value = 'ready'
    } catch (error) {
      if (generation !== renderGeneration || controller !== active || active.isDisposed) return
      console.error('[ChartSurface] 图表渲染失败', error)
      status.value = 'failed'
    }
  }

  watch(
    [options.spec, state, themeIdentity, currentLocale, options.active, reducedMotion],
    ([, , , , active]) => {
      if (!active) {
        releaseInstance()
        return
      }
      void renderNow()
    },
    { flush: 'post' },
  )

  // ---- 主题与尺寸 ----
  let stopObservingTheme: (() => void) | null = null
  let motionQuery: MediaQueryList | null = null
  const updateMotion = () => { reducedMotion.value = motionQuery?.matches ?? false }
  let resizeObserver: ResizeObserver | null = null
  let lastWidth = 0
  let refitFrame = 0

  onMounted(() => {
    stopObservingTheme = observeChartTheme(next => { themeIdentity.value = next })
    motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    updateMotion()
    motionQuery?.addEventListener('change', updateMotion)
    const host = options.plotElement.value
    if (host && typeof ResizeObserver !== 'undefined') {
      lastWidth = host.clientWidth
      resizeObserver = new ResizeObserver(() => {
        const width = host.clientWidth
        if (Math.abs(width - lastWidth) < MIN_WIDTH_CHANGE_PX) return
        lastWidth = width
        cancelAnimationFrame(refitFrame)
        refitFrame = requestAnimationFrame(() => { void renderNow(false) })
      })
      resizeObserver.observe(host)
    }
    if (options.active.value) void renderNow()
  })

  onBeforeUnmount(() => {
    stopObservingTheme?.()
    motionQuery?.removeEventListener('change', updateMotion)
    resizeObserver?.disconnect()
    cancelAnimationFrame(refitFrame)
    releaseInstance()
  })

  // ---- 读者操作 ----
  const filterable = computed(() => supportsSeriesFiltering(options.spec.value))
  const rangeable = computed(() => supportsCategoryRange(options.spec.value))
  const valueRangeable = computed(() => supportsValueRange(options.spec.value))
  const hasReadingOptions = computed(() =>
    options.spec.value.series.length >= 2
    || emphasisTargetsCategories(options.spec.value)
    || rangeable.value
    || valueRangeable.value)

  const actions = {
    toggleSeries: (id: string) => writeState(toggleSeriesVisibility(options.spec.value, state.value, id)),
    toggleEmphasis: (id: string) => writeState(toggleEmphasis(options.spec.value, state.value, id)),
    setCategoryRange: (range: { start: number; end: number } | null) => writeState(setCategoryRange(options.spec.value, state.value, range)),
    setValueRanges: (ranges: Parameters<typeof setValueRanges>[2]) => writeState(setValueRanges(options.spec.value, state.value, ranges)),
    reset: () => writeState(resetReadingState()),
    /** 图例悬停/聚焦时的临时突出：不进入阅读状态。 */
    highlight: (id: string | null) => {
      controller?.highlight(resolveChartHighlight(view.value, id))
    },
  }

  // ---- 复制为图片：默认视图，不受阅读状态影响；失败单独报告 ----
  async function copyImage(): Promise<boolean> {
    try {
      const spec = options.spec.value
      const blob = await renderChartImagePng({
        spec,
        theme: resolveTheme(),
        locale: currentLocale.value,
        messages: messages.value,
        ...(spec.chartType === 'radar' && spec.radarScale
          ? { footnote: editorMessage('editor.chart.radar.scale', { max: spec.radarScale.max }) }
          : {}),
      })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      notifications.show(editorMessage('editor.chart.toast.imageCopied'), 'success', 2000)
      return true
    } catch (error) {
      console.error('[ChartSurface] 复制图表图片失败', error)
      notifications.show(editorMessage('editor.chart.toast.imageCopyFailed'), 'error', 3000)
      return false
    }
  }

  /** 复制完整 canonical 围栏；筛选、聚焦等阅读状态不能改变粘贴后的数据。 */
  async function copyMarkdown(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(encodeMarkdownChartFence(options.spec.value))
      notifications.show(editorMessage('editor.chart.toast.markdownCopied'), 'success', 2000)
      return true
    } catch (error) {
      console.error('[ChartSurface] 复制图表 Markdown 失败', error)
      notifications.show(editorMessage('editor.chart.toast.markdownCopyFailed'), 'error', 3000)
      return false
    }
  }

  return {
    state,
    view,
    legend,
    legendPosition,
    status,
    plotHeight,
    filterable,
    rangeable,
    valueRangeable,
    hasReadingOptions,
    actions,
    copyImage,
    copyMarkdown,
  }
}
