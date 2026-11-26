<template>
  <!--
    坐标头挂在编辑器滚动内容里的 .scroll-content-wrapper，用 absolute 定位（见 tableCoordinateHeaderStyles）：
    纵向滚动由浏览器带着走，滚出编辑区被滚动容器原生裁切；absolute 也不受右侧文档窗格祖先 transform 的影响。
  -->
  <Teleport
    v-if="layer"
    :to="layer"
  >
    <transition name="tt-headers-fade" appear>
    <div v-if="visible" class="tt-table-coordinate-headers">
      <!-- 列标 -->
      <TableColumnHeaders
        v-if="columnWidths.length > 0"
        :column-widths="columnWidths"
        :table-rect="tableRect"
        :scroll-left="scrollLeft"
        :visible-width="tableVisibleWidth"
        :scroll-container="tableScrollContainer"
        :table-scroll-container-rect="tableScrollContainerRect"
        :layer-origin="layerOrigin"
        :scroll-padding-top="scrollPaddingTop"
      />

      <!-- 行标 -->
      <TableRowHeaders
        v-if="rowHeights.length > 0"
        :row-heights="rowHeights"
        :table-rect="tableRect"
        :table-scroll-container-rect="tableScrollContainerRect"
        :layer-origin="layerOrigin"
      />
    </div>
    </transition>
  </Teleport>
</template>

<script setup>
import { onMounted, shallowRef, toRef, watch } from 'vue'
import { onNextFrame } from '@linnya/renderer-ui'
import { useUIStore } from '../../../../../shared/stores/ui'
import TableColumnHeaders from './TableColumnHeaders.vue'
import TableRowHeaders from './TableRowHeaders.vue'
import { getCellBoundingRect } from '../position/tablePositionUtils'
import { useTableCoordinateHeaderController } from './composables/useTableCoordinateHeaderController';
import { useTableCoordinateHeaderLayoutSync } from './composables/useTableCoordinateHeaderLayoutSync';

// DEBUG 工具
const DEBUG = false
const ts = () => (typeof performance !== 'undefined' ? performance.now().toFixed(2) : Date.now())
const dlog = (...args) => { 
  if (DEBUG) {
    console.log(`%c[TableCoordinateHeaders:${ts()}ms]`, 'font-weight: bold;', ...args)
  }
}

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  tableInfo: {
    type: Object,
    default: null
  },
  editor: {
    type: Object,
    required: false,
    default: null
  }
})

const uiStore = useUIStore()

/** 坐标头所在内容层：编辑器滚动内容里的 .scroll-content-wrapper（position: relative）。 */
const layer = shallowRef(null)

const resolveLayer = () => {
  // 编辑器 DOM 挂载后才能定位内容层；下一帧再找，避免拿到尚未插入文档的节点。
  onNextFrame(() => {
    layer.value = props.editor?.view?.dom?.closest?.('.scroll-content-wrapper') ?? null
  })
}

onMounted(resolveLayer)

watch(
  () => props.editor,
  () => {
    layer.value = null
    resolveLayer()
  },
)

const {
  columnWidths,
  rowHeights,
  tableRect,
  scrollLeft,
  tableScrollContainerRect,
  layerOrigin,
  scrollPaddingTop,
  tableVisibleWidth,
  tableScrollContainer,
  measureTablePosition
} = useTableCoordinateHeaderController({
  visible: toRef(props, 'visible'),
  tableInfo: toRef(props, 'tableInfo'),
  editor: toRef(props, 'editor'),
  getCellRect: getCellBoundingRect,
  layerElement: layer,
  debug: dlog
})

// 内容层就位或更换后按新原点重新测量，坐标头才落在正确位置。
watch(layer, (next) => {
  if (next) measureTablePosition()
})

useTableCoordinateHeaderLayoutSync({
  sidebarVisible: toRef(uiStore, 'sidebarVisible'),
  sidebarWidth: toRef(uiStore, 'sidebarWidth'),
  measure: measureTablePosition,
});
</script>
