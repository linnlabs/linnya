<template>
  <!--
    中文说明：
    - 组件根节点必须带 data-mm-interactive="true"（交互门禁）
    - 不要在根节点用 @mousedown.stop：会导致基础设施无法识别真实起点
  -->
  <div class="mm-tagging-badge" data-mm-interactive="true" v-if="shouldRender">
    <!-- 节点类型（kind）徽标 -->
    <TagChip
      v-if="kindConfig"
      class="mm-tagging-chip mm-tagging-chip--kind"
      :class="[`mm-tagging-chip--${kindConfig.className}`]"
      :label="kindConfig.label"
      :title="kindConfig.tooltip"
      :background-color="kindChipColors.backgroundColor"
      :text-color="kindChipColors.textColor"
      :border-color="kindChipColors.borderColor"
      :class-names="{ label: 'mm-tagging-chip-label' }"
    />

    <!-- 状态 Pill -->
    <TagChip
      v-if="statusConfig"
      class="mm-tagging-chip mm-tagging-chip--status"
      :class="[`mm-tagging-chip--${statusConfig.className}`]"
      :label="statusConfig.label"
      :title="statusConfig.label"
      :background-color="statusChipColors.backgroundColor"
      :text-color="statusChipColors.textColor"
      :border-color="statusChipColors.borderColor"
      :class-names="{ label: 'mm-tagging-chip-label' }"
    >
      <template #icon>
        <span class="mm-tagging-status-dot" aria-hidden="true" />
      </template>
    </TagChip>

    <!-- 置信度（小标识 + Tooltip） -->
    <TagChip
      v-if="confidenceConfig"
      class="mm-tagging-chip mm-tagging-chip--confidence"
      :class="[`mm-tagging-chip--${confidenceConfig.className}`]"
      :label="confidenceLabel"
      :title="confidenceConfig.label"
      :background-color="confidenceChipColors.backgroundColor"
      :text-color="confidenceChipColors.textColor"
      :border-color="confidenceChipColors.borderColor"
      :class-names="{ label: 'mm-tagging-chip-label' }"
    />

    <!-- Refuted 解释入口 -->
    <button
      v-if="isRefuted"
      type="button"
      class="mm-tagging-explainer"
      title="查看驳斥证据"
      aria-label="查看驳斥证据"
      @click.stop="openEvidencePanel"
    >
      <InfoIcon class="mm-tagging-explainer-icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * TaggingBadgeAddon.vue
 *
 * 中文说明：
 * - 在节点 addons 的“元信息栏”统一渲染：kind/status/confidence/Refuted 解释入口
 * - 遵循 NodeAddonsRegistry 契约：接受 { mind, nodeId } props
 * - 所有交互通过 mind.bus.fire() 委托，不直接操作 store
 *
 * 设计原则（高内聚低耦合）：
 * - 纯 UI 组件：只负责渲染，业务逻辑在 store/feature 层
 * - 事件驱动：点击感叹号触发 ui:toggleReferenceInNode，由 evidence feature 响应
 * - 响应式依赖：通过 taggingStore 追踪状态变化
 */
import { computed } from 'vue'
import type { MindMapInstance } from '../../../domain/types'
import {
  useMindMapTaggingStore,
  NodeStatusValues,
} from '../domain/store/taggingStore'
import { InfoIcon } from '@linnya/renderer-ui/icons'
import { TagChip } from '@linnya/renderer-ui'
import {
  CONFIDENCE_COLORS,
  KIND_COLORS,
  STATUS_COLORS,
  getTaggingKindDisplayConfig,
  type TaggingChipColors,
} from './taggingChipPresentation'

interface Props {
  mind: MindMapInstance
  nodeId: string
}

const props = defineProps<Props>()

const taggingStore = useMindMapTaggingStore()

// =========================================================================
// Computed
// =========================================================================

const tagging = computed(() => taggingStore.getTagging(props.nodeId))
const status = computed(() => tagging.value?.status)
const confidence = computed(() => tagging.value?.confidence)
const kind = computed(() => {
  const raw = tagging.value?.labels?.kind
  return typeof raw === 'string' ? raw : undefined
})

/**
 * open 是默认态：仅当存在其它元信息（如 kind/confidence）时才需要展示。
 */
const statusConfig = computed(() => {
  if (status.value === NodeStatusValues.OPEN) return null
  return taggingStore.getStatusDisplayConfig(status.value)
})
const confidenceConfig = computed(() => taggingStore.getConfidenceDisplayConfig(confidence.value))

const kindConfig = computed(() => {
  const k = kind.value
  if (!k) return null
  return getTaggingKindDisplayConfig(k)
})

const kindChipColors = computed<TaggingChipColors>(() => {
  const cfg = kindConfig.value
  if (!cfg) return {}
  return KIND_COLORS[cfg.className] ?? KIND_COLORS['mm-kind-badge--unknown']
})

const statusChipColors = computed<TaggingChipColors>(() => {
  const cfg = statusConfig.value
  if (!cfg) return {}
  return STATUS_COLORS[cfg.className] ?? STATUS_COLORS.unknown
})

const confidenceChipColors = computed<TaggingChipColors>(() => {
  const cfg = confidenceConfig.value
  if (!cfg) return {}
  return CONFIDENCE_COLORS[cfg.className] ?? CONFIDENCE_COLORS.unknown
})

/**
 * 是否为 Refuted 状态
 */
const isRefuted = computed(() => status.value === NodeStatusValues.REFUTED)

/**
 * 是否应该渲染（有任何打标信息）
 *
 * 中文说明：
 * - open 状态默认不显示（是默认态）
 * - kind/status/confidence 任一存在时显示
 */
const shouldRender = computed(() => {
  if (!tagging.value) return false
  const { status: s, confidence: c, labels } = tagging.value
  const k = labels?.kind
  const hasKind = typeof k === 'string' && k.length > 0
  // open 状态且无置信度/类型时不显示（注意：confidence=0 也应视为“存在”）
  const hasConfidence = !(c === undefined || c === null)
  if (s === NodeStatusValues.OPEN && !hasConfidence && !hasKind) return false
  return Boolean(s || hasConfidence || hasKind)
})

/**
 * 置信度简短标签（用于小标识）
 */
const confidenceLabel = computed(() => {
  const c = confidence.value
  if (c === undefined || c === null) return ''
  if (typeof c === 'number') {
    if (c >= 0 && c <= 1) return `${Math.round(c * 100)}%`
    return String(c)
  }
  // 字符串置信度：用明确中文语义，避免 “H/M/L” 这种不可读缩写
  if (typeof c === 'string') {
    const map: Record<string, string> = {
      high: '高置信度',
      medium: '中置信度',
      low: '低置信度',
    }
    return map[c] || c
  }
  return ''
})

// =========================================================================
// Methods
// =========================================================================

/**
 * 打开证据面板（复用 evidence feature）
 *
 * 中文说明：
 * - 触发 ui:toggleReferenceInNode 事件
 * - evidence feature 会响应并展开 ReferenceAddon
 */
function openEvidencePanel() {
  props.mind.bus.fire('ui:toggleReferenceInNode', { nodeId: props.nodeId })
}
</script>
