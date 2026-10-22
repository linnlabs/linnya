<template>
  <section
    class="chart-data-table"
    :aria-label="editorMessage('editor.chart.table.title')"
  >
    <header class="chart-data-table__header">
      <h5 class="chart-data-table__title">
        {{ editorMessage('editor.chart.table.title') }}
      </h5>
      <BaseButton
        variant="plain"
        size="sm"
        @click="copy"
      >
        {{ editorMessage('editor.chart.table.copy') }}
      </BaseButton>
    </header>
    <div
      class="chart-data-table__scroll"
      tabindex="0"
    >
      <table class="chart-data-table__grid">
        <thead>
          <tr>
            <th
              v-for="(cell, index) in table.header"
              :key="index"
              scope="col"
            >
              {{ cell }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, rowIndex) in table.rows"
            :key="rowIndex"
          >
            <template
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
            >
              <th
                v-if="cellIndex === 0"
                scope="row"
              >
                {{ cell }}
              </th>
              <td v-else>
                {{ cell }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseButton } from '@linnya/renderer-ui'
import type { MarkdownChartSpec } from '@app/schemas'
import { useNotificationStore } from '@/app/notification'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { buildChartDataTable, chartDataTableToTsv } from '../functions/chartDataTable'

const props = defineProps<{ spec: MarkdownChartSpec }>()

const { currentLocale, editorMessage } = useEditorLocalization()
const notifications = useNotificationStore()

const table = computed(() => buildChartDataTable(props.spec, {
  category: editorMessage('editor.chart.table.category'),
  series: editorMessage('editor.chart.table.series'),
  value: editorMessage('editor.chart.table.value'),
  share: editorMessage('editor.chart.table.share'),
  dimension: editorMessage('editor.chart.table.dimension'),
  pointLabel: editorMessage('editor.chart.table.pointLabel'),
}, currentLocale.value))

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(chartDataTableToTsv(table.value))
    notifications.show(editorMessage('editor.chart.table.copied'), 'success', 2000)
  } catch (error) {
    console.error('[ChartDataTable] 复制数据表失败', error)
    notifications.show(editorMessage('editor.chart.toast.imageCopyFailed'), 'error', 3000)
  }
}
</script>
