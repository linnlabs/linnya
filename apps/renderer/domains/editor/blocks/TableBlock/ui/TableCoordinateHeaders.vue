<template>
  <Teleport v-if="teleportTarget" :to="teleportTarget">
    <transition name="tt-headers-fade" appear>
    <div v-if="visible" class="tt-table-coordinate-headers">
      <!-- 左上角单元格 (已移除) -->

      <!-- 列标 -->
      <TableColumnHeaders
        v-if="columnWidths.length > 0"
        :column-widths="columnWidths"
        :table-rect="tableRect"
        :scroll-left="scrollLeft"
        :scroll-top="scrollTop"
        :container-rect="containerRect"
        :table-element="tableElement"
        :visible-width="tableVisibleWidth"
        :scroll-container="tableScrollContainer"
        :table-scroll-container-rect="tableScrollContainerRect"
        :table-top-in-container="tableTopInContainer"
      />

      <!-- 行标 -->
      <TableRowHeaders
        v-if="rowHeights.length > 0"
        :row-heights="rowHeights"
        :table-rect="tableRect"
        :scroll-left="scrollLeft"
        :scroll-top="scrollTop"
        :container-rect="containerRect"
        :table-element="tableElement"
        :table-scroll-container-rect="tableScrollContainerRect"
        :editor-shell-scrollbar-height="editorShellScrollbarHeight"
        :editor-shell-bottom="editorShellBottomInViewport"
      />
    </div>
    </transition>
  </Teleport>
</template>

<script setup>
import { nextTick, ref, toRef, onMounted, watch } from 'vue'
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

const teleportTarget = ref(null)

const resolveTeleportTarget = async () => {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const editorRoot = props.editor?.view?.dom
  const currentEditorWrapper = editorRoot?.closest?.('.scroll-content-wrapper')
  teleportTarget.value = currentEditorWrapper || null
}

onMounted(resolveTeleportTarget)

watch(
  () => props.editor,
  () => {
    teleportTarget.value = null
    void resolveTeleportTarget()
  },
)

const {
  columnWidths,
  rowHeights,
  tableRect,
  scrollLeft,
  scrollTop,
  containerRect,
  tableScrollContainerRect,
  editorShellScrollbarHeight,
  editorShellBottomInViewport,
  tableVisibleWidth,
  tableTopInContainer,
  tableScrollContainer,
  tableElement,
  measureTablePosition
} = useTableCoordinateHeaderController({
  visible: toRef(props, 'visible'),
  tableInfo: toRef(props, 'tableInfo'),
  editor: toRef(props, 'editor'),
  getCellRect: getCellBoundingRect,
  debug: dlog
})

useTableCoordinateHeaderLayoutSync({
  sidebarVisible: toRef(uiStore, 'sidebarVisible'),
  sidebarWidth: toRef(uiStore, 'sidebarWidth'),
  measure: measureTablePosition,
});
</script>
