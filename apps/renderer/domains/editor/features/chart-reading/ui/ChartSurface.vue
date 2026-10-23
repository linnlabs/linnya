<template>
  <figure
    class="chart-surface"
    :class="{ 'is-inactive': !active, 'is-custom-view': !view.isDefault }"
    :data-chart-type="spec.chartType"
    :aria-label="spec.title ? undefined : typeLabel"
    :aria-labelledby="spec.title ? titleId : undefined"
    :aria-describedby="spec.description ? descriptionId : undefined"
  >
    <header
      class="chart-surface__header"
      :class="{ 'chart-surface__header--floating': !hasHeading }"
    >
      <div
        v-if="hasHeading"
        class="chart-surface__heading"
      >
        <p
          v-if="spec.title"
          :id="titleId"
          class="chart-surface__title"
        >
          {{ spec.title }}
        </p>
        <p
          v-if="spec.description"
          :id="descriptionId"
          class="chart-surface__description"
        >
          {{ spec.description }}
        </p>
      </div>
      <div
        class="chart-surface__actions"
        role="toolbar"
        :aria-label="editorMessage('editor.chart.toolbar.aria')"
      >
        <IconButton
          v-if="!view.isDefault"
          :label="editorMessage('editor.chart.action.resetView')"
          @click.stop="actions.reset()"
        >
          <RefreshIcon />
        </IconButton>
        <CustomSelect
          :model-value="null"
          :options="copyOptions"
          :title="editorMessage('editor.chart.action.copy')"
          :trigger-aria-label="editorMessage('editor.chart.action.copy')"
          semantic-role="menu"
          variant="minimal"
          :bordered="false"
          :disabled="copying"
          min-width="max-content"
          :class-names="{
            trigger: 'chart-surface__copy-trigger',
            selectedValue: 'chart-surface__copy-value',
            options: 'chart-surface__copy-options',
          }"
          @click.stop
          @update:model-value="onCopy"
        >
          <template #arrow-icon>
            <span
              class="chart-surface__copy-icons"
              aria-hidden="true"
            >
              <CopyIcon class="chart-surface__copy-symbol" />
              <ChevronIcon
                class="chart-surface__copy-chevron"
                direction="right"
              />
            </span>
          </template>
        </CustomSelect>
      </div>
    </header>

    <div
      class="chart-surface__body"
      :data-legend="legendPosition"
    >
      <ChartLegend
        v-if="legendBefore"
        :items="legend"
        :position="legendBefore"
        @toggle-series="actions.toggleSeries"
        @toggle-emphasis="actions.toggleEmphasis"
        @hover="actions.highlight"
      />
      <div class="chart-surface__plot-wrap">
        <div
          ref="plotRef"
          class="chart-surface__plot"
          role="img"
          :aria-label="plotLabel"
          :style="{ '--chart-plot-height': `${plotHeight}px` }"
        />
        <p
          v-if="allSeriesHidden"
          class="chart-surface__notice"
        >
          {{ editorMessage('editor.chart.view.allHidden') }}
        </p>
        <p
          v-else-if="status === 'failed'"
          class="chart-surface__notice chart-surface__notice--error"
          role="status"
        >
          {{ editorMessage('editor.chart.status.runtimeFailed') }}
        </p>
        <p
          v-else-if="status === 'loading'"
          class="chart-surface__notice"
          role="status"
        >
          {{ editorMessage('editor.chart.status.loading') }}
        </p>
      </div>
      <ChartLegend
        v-if="legendAfter"
        :items="legend"
        :position="legendAfter"
        @toggle-series="actions.toggleSeries"
        @toggle-emphasis="actions.toggleEmphasis"
        @hover="actions.highlight"
      />
    </div>

    <p
      v-if="spec.chartType === 'radar'"
      class="chart-surface__footnote"
    >
      {{ editorMessage('editor.chart.radar.scale', { max: spec.radarScale.max }) }}
    </p>
    <p
      v-if="!view.isDefault"
      class="chart-surface__view-note"
    >
      <span>{{ editorMessage('editor.chart.view.customNote') }}</span>
      <BaseButton
        variant="plain"
        size="sm"
        @click.stop="actions.reset()"
      >
        {{ editorMessage('editor.chart.action.resetView') }}
      </BaseButton>
    </p>
  </figure>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { BaseButton, CustomSelect, IconButton, type CustomSelectOption } from '@linnya/renderer-ui'
import { ChevronIcon, CopyIcon, RefreshIcon } from '@linnya/renderer-ui/icons'
import type { MarkdownChartSpec } from '@app/schemas'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { useChartSurfaceRuntime } from '../orchestration/useChartSurfaceRuntime'
import type { ChartReadingKey } from '../definitions/chartReadingState'
import ChartLegend from './ChartLegend.vue'

const props = withDefaults(defineProps<{
  spec: MarkdownChartSpec
  /** 阅读状态的会话键；null 表示不进入会话存储（编辑预览）。 */
  readingKey?: ChartReadingKey | null
  /** 是否持有 ECharts 实例（可见或预热区域内）。离屏时只保留占位与阅读状态。 */
  active?: boolean
  /** false：规格或阅读状态变化时直接呈现最终结果，不播放过渡。 */
  transitions?: boolean
}>(), {
  readingKey: null,
  active: true,
  transitions: true,
})

const { editorMessage } = useEditorLocalization()
const plotRef = ref<HTMLElement | null>(null)
const copying = ref(false)
// Tiptap 的 NodeView 各自挂载 Vue 根，useId 只能保证单个应用内唯一，会让多图关联到首图标题。
const instanceId = `chart-${crypto.randomUUID()}`
const titleId = `${instanceId}-title`
const descriptionId = `${instanceId}-description`

const {
  view, legend, legendPosition, status, plotHeight, actions, copyImage, copyMarkdown,
} = useChartSurfaceRuntime({
  spec: toRef(props, 'spec'),
  readingKey: toRef(props, 'readingKey'),
  active: toRef(props, 'active'),
  plotElement: plotRef,
  transitions: toRef(props, 'transitions'),
})

const hasHeading = computed(() => Boolean(props.spec.title || props.spec.description))
const copyOptions = computed<readonly CustomSelectOption<'image' | 'markdown'>[]>(() => [
  { value: 'image', text: editorMessage('editor.chart.action.copyImage') },
  { value: 'markdown', text: editorMessage('editor.chart.action.copyMarkdown') },
])
// 图例的 DOM 顺序与视觉顺序一致：上/左在绘图区之前，下/右在其后。
const legendBefore = computed(() => (legendPosition.value === 'top' || legendPosition.value === 'left' ? legendPosition.value : null))
const legendAfter = computed(() => (legendPosition.value === 'bottom' || legendPosition.value === 'right' ? legendPosition.value : null))
const typeLabel = computed(() => editorMessage(`editor.chart.type.${props.spec.chartType}`))
const plotLabel = computed(() => (props.spec.title ? `${typeLabel.value} · ${props.spec.title}` : typeLabel.value))

const allSeriesHidden = computed(() =>
  props.spec.chartType !== 'pie'
  && props.spec.chartType !== 'doughnut'
  && view.value.seriesVisible.every(visible => !visible))

async function onCopy(format: 'image' | 'markdown'): Promise<void> {
  copying.value = true
  try {
    if (format === 'image') await copyImage()
    else await copyMarkdown()
  } finally {
    copying.value = false
  }
}
</script>
