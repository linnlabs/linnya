<template>
  <div
    ref="floatingRef"
    class="tt-table-row-headers"
    :style="floatingStyle"
  >
    <div
      v-for="(height, index) in rowHeights"
      :key="index"
      class="tt-row-header-cell"
      :style="{ height: `${height}px` }"
    >
      {{ index + 1 }}
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { buildTableRowHeaderStyle } from './composables/tableCoordinateHeaderStyles'

const props = defineProps({
  rowHeights: {
    type: Array,
    required: true
  },
  tableRect: {
    type: Object,
    required: true
  },
  tableScrollContainerRect: {
    type: Object,
    required: true
  },
  editorShellScrollbarHeight: {
    type: Number,
    default: 0
  },
  editorShellBottom: {
    type: Number,
    default: 0
  }
})

const floatingStyle = ref({})

const updatePosition = () => {
  floatingStyle.value = buildTableRowHeaderStyle({
    tableRect: props.tableRect,
    tableScrollContainerRect: props.tableScrollContainerRect,
    editorShellBottom: props.editorShellBottom
  })
}

watch(
  [() => props.tableRect, () => props.tableScrollContainerRect, () => props.editorShellBottom],
  updatePosition,
  { immediate: true, deep: true }
)
</script>
