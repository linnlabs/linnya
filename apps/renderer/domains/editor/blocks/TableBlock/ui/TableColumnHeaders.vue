<template>
  <div
    ref="floatingRef"
    class="tt-table-column-headers"
    :style="floatingStyle"
  >
    <div
      class="tt-table-column-headers-scroller"
      :style="scrollerStyle"
    >
      <div
        v-for="(width, index) in columnWidths"
        :key="index"
        class="tt-col-header-cell"
        :style="{ width: `${width}px` }"
      >
        {{ columnIndexToLetters(index) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { columnIndexToLetters } from '../position/tableCoordinateUtils'
import { buildTableColumnHeaderStyles } from './composables/tableCoordinateHeaderStyles'

const props = defineProps({
  columnWidths: {
    type: Array,
    required: true
  },
  tableRect: {
    type: Object,
    required: true
  },
  scrollLeft: {
    type: Number,
    default: 0
  },
  scrollTop: {
    type: Number,
    default: 0
  },
  containerRect: {
    type: Object,
    required: true
  },
  tableElement: {
    type: Object,
    default: null
  },
  visibleWidth: {
    type: Number,
    default: 0
  },
  scrollContainer: {
    type: Object,
    default: null
  },
  tableScrollContainerRect: {
    type: Object,
    required: true
  },
  tableTopInContainer: {
    type: Number,
    default: 0
  }
})

const floatingRef = ref(null)
const floatingStyle = ref({})
const scrollerStyle = ref({})

const updatePosition = () => {
  const nextStyles = buildTableColumnHeaderStyles({
    columnWidths: props.columnWidths,
    tableRect: props.tableRect,
    scrollLeft: props.scrollLeft,
    containerRect: props.containerRect,
    tableScrollContainerRect: props.tableScrollContainerRect,
    visibleWidth: props.visibleWidth,
    hasScrollContainer: !!props.scrollContainer
  })

  floatingStyle.value = nextStyles.floatingStyle
  scrollerStyle.value = nextStyles.scrollerStyle
}

// 说明：定位由父级 controller 统一监听滚动 / resize / hydrate 后 DOM 重绑；
// 子组件只消费测量结果，避免持有可能过期的 scrollContainer autoUpdate。

watch([
  () => props.tableRect,
  () => props.scrollTop,
  () => props.scrollLeft,
  () => props.containerRect,
  () => props.columnWidths,
  () => props.visibleWidth,
  () => props.scrollContainer,
  () => props.tableScrollContainerRect,
  () => props.tableTopInContainer
], updatePosition, { immediate: true, deep: true })
</script>
