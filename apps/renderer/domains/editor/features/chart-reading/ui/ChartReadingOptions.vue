<template>
  <section
    class="chart-reading-options"
    :aria-label="editorMessage('editor.chart.reading.title')"
  >
    <header class="chart-reading-options__header">
      <h5 class="chart-reading-options__title">
        {{ editorMessage('editor.chart.reading.title') }}
      </h5>
      <BaseButton
        variant="plain"
        size="sm"
        :disabled="view.isDefault"
        @click="emit('reset')"
      >
        {{ editorMessage('editor.chart.action.resetView') }}
      </BaseButton>
    </header>
    <p class="chart-reading-options__hint">
      {{ editorMessage('editor.chart.reading.hint') }}
    </p>

    <fieldset class="chart-reading-options__group">
      <legend class="chart-reading-options__legend">
        {{ partsMode ? editorMessage('editor.chart.reading.parts') : editorMessage('editor.chart.reading.series') }}
      </legend>
      <ul class="chart-reading-options__list">
        <li
          v-for="item in legend"
          :key="item.id"
          class="chart-reading-options__row"
        >
          <span
            class="chart-reading-options__key"
            :data-shape="item.shape"
            :style="{ '--chart-legend-fill': item.fill, '--chart-legend-ink': item.ink }"
            aria-hidden="true"
          />
          <span class="chart-reading-options__label">{{ item.label }}</span>
          <span class="chart-reading-options__cell">
            <CustomCheckbox
              v-if="item.filterable"
              :model-value="!item.hidden"
              @update:model-value="emit('toggle-series', item.id)"
            >
              {{ editorMessage('editor.chart.reading.visible') }}
            </CustomCheckbox>
          </span>
          <span class="chart-reading-options__cell">
            <CustomCheckbox
              v-if="!item.hidden"
              :model-value="item.emphasized"
              @update:model-value="emit('toggle-emphasis', item.id)"
            >
              {{ editorMessage('editor.chart.reading.emphasize') }}
            </CustomCheckbox>
          </span>
        </li>
      </ul>
    </fieldset>

    <fieldset
      v-if="rangeable && spec.categories.length > 2"
      class="chart-reading-options__group"
    >
      <legend class="chart-reading-options__legend">
        {{ editorMessage('editor.chart.reading.categoryRange') }}
      </legend>
      <div class="chart-reading-options__range">
        <div class="chart-reading-options__field">
          <span class="chart-reading-options__field-label">{{ editorMessage('editor.chart.reading.rangeFrom') }}</span>
          <CustomSelect
            :model-value="rangeStart"
            :options="categoryOptions"
            :trigger-aria-label="editorMessage('editor.chart.reading.rangeFrom')"
            use-portal-to-body
            @update:model-value="onCategoryEdge('start', $event)"
          />
        </div>
        <div class="chart-reading-options__field">
          <span class="chart-reading-options__field-label">{{ editorMessage('editor.chart.reading.rangeTo') }}</span>
          <CustomSelect
            :model-value="rangeEnd"
            :options="categoryOptions"
            :trigger-aria-label="editorMessage('editor.chart.reading.rangeTo')"
            use-portal-to-body
            @update:model-value="onCategoryEdge('end', $event)"
          />
        </div>
        <BaseButton
          variant="plain"
          size="sm"
          :disabled="view.state.categoryRange === null"
          @click="emit('set-category-range', null)"
        >
          {{ editorMessage('editor.chart.reading.clearRange') }}
        </BaseButton>
      </div>
    </fieldset>

    <template v-if="valueRangeable">
      <fieldset
        v-for="axis in valueAxes"
        :key="axis.key"
        class="chart-reading-options__group"
        @focusout="onRangeFocusOut(axis.key, $event)"
      >
        <legend class="chart-reading-options__legend">
          {{ editorMessage(axis.legend) }}
        </legend>
        <div class="chart-reading-options__range">
          <CustomNumberInput
            :model-value="drafts[axis.key].min"
            :label="editorMessage('editor.chart.reading.min')"
            variant="panel"
            :aria-invalid="isInvalid(axis.key)"
            @update:model-value="onDraft(axis.key, 'min', $event)"
          />
          <CustomNumberInput
            :model-value="drafts[axis.key].max"
            :label="editorMessage('editor.chart.reading.max')"
            variant="panel"
            :aria-invalid="isInvalid(axis.key)"
            @update:model-value="onDraft(axis.key, 'max', $event)"
          />
          <BaseButton
            variant="plain"
            size="sm"
            :disabled="axis.range === null && !hasDraft(axis.key)"
            @click="clearAxis(axis.key)"
          >
            {{ editorMessage('editor.chart.reading.clearRange') }}
          </BaseButton>
        </div>
        <p
          v-if="isInvalid(axis.key)"
          class="chart-reading-options__error"
          role="alert"
        >
          {{ editorMessage('editor.chart.reading.rangeInvalid') }}
        </p>
      </fieldset>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseButton, CustomCheckbox, CustomNumberInput, CustomSelect } from '@linnya/renderer-ui'
import type { MarkdownChartSpec } from '@app/schemas'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import type { ChartValueRange } from '../definitions/chartReadingState'
import type { ChartLegendItem } from '../functions/chartLegend'
import { emphasisTargetsCategories } from '../functions/chartReadingState'
import type { ChartReadingView } from '../functions/chartReadingView'
import {
  draftMatchesRange,
  draftOfRange,
  EMPTY_CHART_VALUE_RANGE_DRAFT,
  nextDraftText,
  resolveValueRangeDraft,
  type ChartValueRangeDraft,
} from '../functions/chartValueRangeDraft'

type ValueAxisKey = 'xRange' | 'yRange'

const props = defineProps<{
  spec: MarkdownChartSpec
  view: ChartReadingView
  legend: readonly ChartLegendItem[]
  rangeable: boolean
  valueRangeable: boolean
}>()

const emit = defineEmits<{
  'toggle-series': [id: string]
  'toggle-emphasis': [id: string]
  'set-category-range': [range: { start: number; end: number } | null]
  'set-value-ranges': [ranges: { xRange?: ChartValueRange | null; yRange?: ChartValueRange | null }]
  reset: []
}>()

const { editorMessage } = useEditorLocalization()

const partsMode = computed(() => emphasisTargetsCategories(props.spec))
const rangeStart = computed(() => props.view.state.categoryRange?.start ?? 0)
const rangeEnd = computed(() => props.view.state.categoryRange?.end ?? props.spec.categories.length - 1)
const categoryOptions = computed(() => props.spec.categories.map((category, index) => ({ value: index, text: String(category) })))

function onCategoryEdge(edge: 'start' | 'end', value: number): void {
  emit('set-category-range', edge === 'start'
    ? { start: value, end: Math.max(value, rangeEnd.value) }
    : { start: Math.min(value, rangeStart.value), end: value })
}

// ---- 散点 X/Y 范围：输入草稿 → 合法范围才提交 ----
const valueAxes = computed(() => [
  { key: 'xRange' as const, legend: 'editor.chart.reading.xRange' as const, range: props.view.state.xRange },
  { key: 'yRange' as const, legend: 'editor.chart.reading.yRange' as const, range: props.view.state.yRange },
])

const drafts = ref<Record<ValueAxisKey, ChartValueRangeDraft>>({
  xRange: draftOfRange(props.view.state.xRange),
  yRange: draftOfRange(props.view.state.yRange),
})

function rangeOf(key: ValueAxisKey): ChartValueRange | null {
  return key === 'xRange' ? props.view.state.xRange : props.view.state.yRange
}

// 状态由外部改变（重置、规格变化）时让草稿跟上；数值相同的输入原文不被改写。
watch(() => [props.view.state.xRange, props.view.state.yRange] as const, () => {
  for (const key of ['xRange', 'yRange'] as const) {
    if (!draftMatchesRange(drafts.value[key], rangeOf(key))) drafts.value[key] = draftOfRange(rangeOf(key))
  }
})

function onDraft(key: ValueAxisKey, edge: 'min' | 'max', emitted: number | string): void {
  const current = drafts.value[key]
  const next = { ...current, [edge]: nextDraftText(current[edge], emitted) }
  drafts.value[key] = next
  const resolution = resolveValueRangeDraft(next)
  if (resolution.kind === 'range') emit('set-value-ranges', { [key]: resolution.range })
  else if (resolution.kind === 'clear' && rangeOf(key) !== null) emit('set-value-ranges', { [key]: null })
}

function isInvalid(key: ValueAxisKey): boolean {
  return resolveValueRangeDraft(drafts.value[key]).kind === 'invalid'
}

function hasDraft(key: ValueAxisKey): boolean {
  return !draftMatchesRange(drafts.value[key], null)
}

function clearAxis(key: ValueAxisKey): void {
  drafts.value[key] = EMPTY_CHART_VALUE_RANGE_DRAFT
  if (rangeOf(key) !== null) emit('set-value-ranges', { [key]: null })
}

/** 焦点离开整组输入时，把未完成/无效的草稿收回到当前真实范围；组内切换不打断输入。 */
function onRangeFocusOut(key: ValueAxisKey, event: FocusEvent): void {
  const group = event.currentTarget
  if (group instanceof Node && event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return
  if (!draftMatchesRange(drafts.value[key], rangeOf(key))) drafts.value[key] = draftOfRange(rangeOf(key))
}
</script>
