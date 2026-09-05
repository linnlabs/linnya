<!--
  HistoryTimeline.vue
  
  块级时光机 - 底部「横向时间轴」控制器（方案 A）
  
  - 占据一行高度：中间是一条可点击/可拖动的时间轴
  - 轴上的圆点表示各个版本，颜色区分来源（AI / 手动 / 恢复）
  - 中央滑块表示当前对比的历史版本，拖动或点击轴即可快速切换
-->

<template>
  <div v-if="isActive" class="history-timeline">
    <div class="timeline-main-row">
      <!-- 横向时间轴（自适应宽度，可溢出滚动） -->
      <div ref="axisRef" class="timeline-axis" @click="handleAxisClick">
        <div ref="axisInnerRef" class="timeline-axis-inner">
          <!-- 轨道（长度从第一个圆点中心到最后一个圆点中心） -->
          <div class="timeline-track" :style="trackStyle" />

          <!-- 各个版本节点：点 + 下方文案 -->
          <div
            v-for="(version, index) in versions"
            :key="version.id"
            ref="nodeEls"
            class="timeline-node"
            @click.stop="selectVersion(version.id)"
          >
            <!-- 顶部：时间轴上的圆点区域，固定高度，确保与轨道对齐 -->
            <div class="timeline-node-dot">
              <button
                type="button"
                class="timeline-dot"
                :class="getOriginClass(version.origin_type)"
              >
                <span class="dot-indicator" />
              </button>
            </div>
            <!-- 底部：版本与时间文案 -->
            <div class="timeline-node-label">
              <span class="node-version">v{{ version.version_number }}</span>
              <span class="node-time">{{ formatTime(version.created_at) }}</span>
            </div>
          </div>

          <!-- 当前选中版本的滑块（可拖动，跟随节点中心） -->
          <div
            v-if="selectedVersion"
            class="timeline-handle"
            :class="{ dragging: isDraggingHandle }"
            :style="handleStyle"
            @mousedown.prevent="onHandleMouseDown"
          />
        </div>
      </div>

      <!-- 右侧：操作按钮组 -->
      <div v-if="selectedVersion" class="timeline-actions">
        <ActionButtons
          class="history-timeline-actions"
          :primary-action-text="editorMessage('editor.blockHistory.timeline.applyVersion', { version: selectedVersion.version_number })"
          :secondary-action-text="editorMessage('editor.blockHistory.timeline.exit')"
          :primary-button-attributes="{ class: 'history-timeline-action-button' }"
          :secondary-button-attributes="{
            class: 'history-timeline-action-button history-timeline-exit-button',
          }"
          secondary-variant="plain"
          @primary-click="handleQuickRestore(selectedVersion.id)"
          @secondary-click="handleExit"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useBlockHistoryStore, type BlockVersion } from '../index'
import { ActionButtons } from '@linnya/renderer-ui'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { formatBlockHistoryShortTime } from '../functions/blockHistoryPresentation'

// ==================== Props ====================

const props = defineProps<{
  /** 块 ID */
  blockId: string
  /** 文档节点 ID */
  documentNodeId?: string
}>()

// ==================== Emits ====================

const emit = defineEmits<{
  (e: 'exit'): void
  (e: 'version-select', versionId: string): void
  (e: 'restore', versionId: string): void
}>()

// ==================== Store ====================

const blockHistoryStore = useBlockHistoryStore()
const { currentLocale, editorMessage } = useEditorLocalization()

// ==================== Refs ====================

/** 时间轴根元素，用于计算点击 / 拖动位置 */
const axisRef = ref<HTMLElement | null>(null)
/** 轴内层容器（用于获取实际内容宽度） */
const axisInnerRef = ref<HTMLElement | null>(null)
/** 各个版本节点 DOM 引用列表（与 versions 对齐） */
const nodeEls = ref<HTMLElement[] | null>(null)

/** 是否正在拖动滑块 */
const isDraggingHandle = ref(false)

let handleMoveListener: ((event: MouseEvent) => void) | null = null
let handleUpListener: ((event: MouseEvent) => void) | null = null

// ==================== 计算属性 ====================

/** 是否激活时间轴 */
const isActive = computed(() => {
  return blockHistoryStore.isInHistoryMode(props.blockId)
})

/** UI 状态 */
const uiState = computed(() => {
  return blockHistoryStore.getUiState(props.blockId)
})

/** 是否加载中 */
const isLoading = computed(() => {
  return uiState.value.isLoading
})

/** 选中的历史版本 ID */
const selectedVersionId = computed(() => {
  return uiState.value.selectedVersionId
})

/** 原始版本列表（按后端返回顺序，一般为「最新在前」） */
const rawVersions = computed<BlockVersion[]>(() => {
  return blockHistoryStore.getVersions(props.blockId)
})

/** 时间轴使用的版本列表（从左到右：最旧 -> 最新） */
const versions = computed<BlockVersion[]>(() => {
  const list = rawVersions.value
  if (!list || list.length === 0) return []
  // 复制一份避免修改原数组，然后反转顺序
  return [...list].reverse()
})

/** 当前选中的历史版本对象 */
const selectedVersion = computed<BlockVersion | null>(() => {
  if (!selectedVersionId.value) return null
  const list = versions.value
  if (!list.length) return null
  return list.find(version => version.id === selectedVersionId.value) ?? null
})

/** 横线样式：从第一个圆点中心到最后一个圆点中心 */
const trackStyle = computed(() => {
  const axisEl = axisRef.value
  const nodes = nodeEls.value
  const list = versions.value

  if (!axisEl || !nodes || !nodes.length || list.length < 2) {
    return { display: 'none' }
  }

  const firstNode = nodes[0]
  const lastNode = nodes[nodes.length - 1]

  if (!firstNode || !lastNode) {
    return { display: 'none' }
  }

  const axisRect = axisEl.getBoundingClientRect()
  const firstRect = firstNode.getBoundingClientRect()
  const lastRect = lastNode.getBoundingClientRect()

  // 计算第一个节点中心相对 axis 左侧的位置（考虑 scrollLeft）
  const firstCenterX = (firstRect.left + firstRect.width / 2) - axisRect.left + axisEl.scrollLeft
  // 计算最后一个节点中心相对 axis 左侧的位置（考虑 scrollLeft）
  const lastCenterX = (lastRect.left + lastRect.width / 2) - axisRect.left + axisEl.scrollLeft

  // 横线从第一个圆点中心开始，到最后一个圆点中心结束
  const left = Math.min(firstCenterX, lastCenterX)
  const width = Math.abs(lastCenterX - firstCenterX)

  return {
    left: `${left}px`,
    width: `${width}px`,
  }
})

/** 滑块样式：根据选中节点的实际几何中心计算 */
const handleStyle = computed(() => {
  const axisEl = axisRef.value
  const nodes = nodeEls.value
  const current = selectedVersion.value
  const list = versions.value

  if (!axisEl || !nodes || !current || !list.length) {
    return {}
  }

  const index = list.findIndex(v => v.id === current.id)
  if (index < 0 || !nodes[index]) return {}

  const nodeEl = nodes[index]
  const axisRect = axisEl.getBoundingClientRect()
  const nodeRect = nodeEl.getBoundingClientRect()

  // 计算节点中心相对 axis 左侧的位置（考虑 scrollLeft）
  const centerXInAxis = (nodeRect.left + nodeRect.width / 2) - axisRect.left + axisEl.scrollLeft

  return {
    left: `${centerXInAxis}px`,
  }
})

// ==================== 方法：时间 & 标签 ====================

/** 格式化时间（简短版，相对时间优先） */
function formatTime(timestamp: number): string {
  return formatBlockHistoryShortTime(timestamp, currentLocale.value, editorMessage)
}

/** 获取来源类型样式类 */
function getOriginClass(originType: string): string {
  return `origin-${originType}`
}

// ==================== 方法：时间轴几何计算 ====================

/** 根据鼠标的 X 坐标，选择最近的版本 */
function updateVersionByClientX(clientX: number): void {
  const nodes = nodeEls.value
  const list = versions.value

  if (!nodes || !nodes.length || !list.length) return

  let nearestIndex = 0
  let minDist = Number.POSITIVE_INFINITY

  nodes.forEach((node, idx) => {
    if (!node) return
    const rect = node.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const dist = Math.abs(centerX - clientX)
    if (dist < minDist) {
      minDist = dist
      nearestIndex = idx
    }
  })

  const version = list[nearestIndex]

  if (!version || version.id === selectedVersionId.value) return

  selectVersion(version.id)
}

/** 点击时间轴任意位置：跳转到最近的版本 */
function handleAxisClick(event: MouseEvent): void {
  if (isLoading.value) return
  updateVersionByClientX(event.clientX)
}

/** 滑块按下：开始拖动 */
function onHandleMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return
  if (!axisRef.value || versions.value.length === 0) return

  isDraggingHandle.value = true

  const onMove = (moveEvent: MouseEvent) => {
    updateVersionByClientX(moveEvent.clientX)
  }

  const onUp = () => {
    isDraggingHandle.value = false
    if (handleMoveListener) {
      window.removeEventListener('mousemove', handleMoveListener)
    }
    if (handleUpListener) {
      window.removeEventListener('mouseup', handleUpListener)
    }
    handleMoveListener = null
    handleUpListener = null
  }

  handleMoveListener = onMove
  handleUpListener = onUp

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// ==================== 方法：模式 & 版本操作 ====================

/** 选择版本 */
function selectVersion(versionId: string): void {
  blockHistoryStore.selectVersion(props.blockId, versionId)
  emit('version-select', versionId)
}

/** 退出时间轴 */
function handleExit(): void {
  blockHistoryStore.exitHistoryMode(props.blockId)
  emit('exit')
}

/** 快速恢复 */
async function handleQuickRestore(versionId: string): Promise<void> {
  // 将恢复逻辑交给上层的 useBlockHistoryUi 统一处理（包含提示和退出历史模式）
  emit('restore', versionId)
}

// ==================== 生命周期 ====================

// 首次进入历史模式时，自动选中最新的历史版本（时间轴最右侧）
watch(isActive, (active) => {
  if (active && versions.value.length > 0 && !selectedVersionId.value) {
    const latest = rawVersions.value[0] ?? versions.value[versions.value.length - 1]
    if (latest) {
      selectVersion(latest.id)
    }
  }
}, { immediate: true })

onBeforeUnmount(() => {
  if (handleMoveListener) {
    window.removeEventListener('mousemove', handleMoveListener)
  }
  if (handleUpListener) {
    window.removeEventListener('mouseup', handleUpListener)
  }
  handleMoveListener = null
  handleUpListener = null
})
</script>
