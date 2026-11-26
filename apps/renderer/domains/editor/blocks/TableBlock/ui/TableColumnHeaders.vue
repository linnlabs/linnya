<template>
  <!-- 轨道与表格等高（向上多一条列标高度），列标条在其中 sticky 贴住编辑区顶部，表格滚出去时随轨道离开。 -->
  <div
    class="tt-table-column-headers-track"
    :style="trackStyle"
  >
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
  layerOrigin: {
    type: Object,
    required: true
  },
  scrollPaddingTop: {
    type: Number,
    default: 0
  }
})

const floatingRef = ref(null)
const trackStyle = ref({})
const floatingStyle = ref({})
const scrollerStyle = ref({})

const updatePosition = () => {
  const nextStyles = buildTableColumnHeaderStyles({
    columnWidths: props.columnWidths,
    tableRect: props.tableRect,
    scrollLeft: props.scrollLeft,
    tableScrollContainerRect: props.tableScrollContainerRect,
    visibleWidth: props.visibleWidth,
    hasScrollContainer: !!props.scrollContainer,
    layerOrigin: props.layerOrigin,
    scrollPaddingTop: props.scrollPaddingTop
  })
  trackStyle.value = nextStyles.trackStyle
  floatingStyle.value = nextStyles.floatingStyle
  scrollerStyle.value = nextStyles.scrollerStyle
}

// 说明：定位由父级 controller 统一监听滚动 / resize / hydrate 后 DOM 重绑；
// 子组件只消费测量结果。纵向滚动由浏览器带着轨道走，这里不必为 scrollTop 重算。
watch([
  () => props.tableRect,
  () => props.scrollLeft,
  () => props.columnWidths,
  () => props.visibleWidth,
  () => props.scrollContainer,
  () => props.tableScrollContainerRect,
  () => props.layerOrigin,
  () => props.scrollPaddingTop
], updatePosition, { immediate: true, deep: true })
</script>
