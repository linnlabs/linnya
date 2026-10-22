<template>
  <ul
    class="chart-legend"
    :class="`chart-legend--${position}`"
    :aria-label="editorMessage('editor.chart.legend.aria')"
  >
    <li
      v-for="item in items"
      :key="item.id"
      class="chart-legend__entry"
    >
      <button
        type="button"
        class="chart-legend__item"
        :class="{ 'is-hidden': item.hidden, 'is-emphasized': item.emphasized }"
        :aria-pressed="isPressed(item)"
        :title="describe(item)"
        @click="activate(item)"
        @mouseenter="emit('hover', item.id)"
        @mouseleave="emit('hover', null)"
        @focus="emit('hover', item.id)"
        @blur="emit('hover', null)"
      >
        <span
          class="chart-legend__key"
          :data-shape="item.shape"
          :style="{ '--chart-legend-color': item.color }"
          aria-hidden="true"
        />
        <span class="chart-legend__label">{{ item.label }}</span>
        <span
          v-if="item.secondaryAxis"
          class="chart-legend__hint"
        >{{ editorMessage('editor.chart.legend.secondaryAxis') }}</span>
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import type { ChartLegendItem, ChartLegendPosition } from '../functions/chartLegend'

defineProps<{
  items: readonly ChartLegendItem[]
  position: Exclude<ChartLegendPosition, 'none'>
}>()

const emit = defineEmits<{
  'toggle-series': [id: string]
  'toggle-emphasis': [id: string]
  hover: [id: string | null]
}>()

const { editorMessage } = useEditorLocalization()

/** 可筛选的系列：按下表示“显示中”；饼/环的组成部分：按下表示“被突出”。 */
function isPressed(item: ChartLegendItem): boolean {
  return item.filterable ? !item.hidden : item.emphasized
}

function describe(item: ChartLegendItem): string {
  return item.filterable
    ? editorMessage('editor.chart.legend.toggleSeries', { name: item.label })
    : editorMessage('editor.chart.legend.emphasizePart', { name: item.label })
}

function activate(item: ChartLegendItem): void {
  if (item.filterable) emit('toggle-series', item.id)
  else emit('toggle-emphasis', item.id)
}
</script>
