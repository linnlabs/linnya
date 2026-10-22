<template>
  <node-view-wrapper
    class="chart-block-node-view is-readonly"
    :data-chart-block-id="blockId"
  >
    <ChartSurface
      v-if="spec"
      :spec="spec"
      :reading-key="null"
      :transitions="false"
    />
    <p
      v-else
      class="chart-block-node-view__invalid"
      role="alert"
    >
      {{ editorMessage('editor.chart.status.renderFailed') }}
    </p>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { MarkdownChartSpecSchema, type MarkdownChartSpec } from '@app/schemas'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { ChartSurface } from '../../../features/chart-reading'

const props = defineProps(nodeViewProps)
const { editorMessage } = useEditorLocalization()

const blockId = computed<string>(() => {
  const id: unknown = props.node.attrs['id']
  return typeof id === 'string' ? id : ''
})

const spec = computed<MarkdownChartSpec | null>(() => {
  const parsed = MarkdownChartSpecSchema.safeParse(props.node.attrs['spec'])
  return parsed.success ? parsed.data : null
})
</script>
