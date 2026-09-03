<template>
  <!--
    中文说明：
    - 组件根节点必须带 data-mm-interactive="true"（交互门禁）
    - 不要在根节点用 @mousedown.stop：会导致基础设施无法识别真实起点，出现拖拽穿透/无法框选复制
  -->
  <div ref="rootEl" class="mm-evidence-in-node" data-mm-interactive="true">
    <div
      v-if="expanded || shouldShowPreview"
      class="mm-evidence-container"
      :style="evidenceContainerStyle"
      :class="{ 'is-expanded': expanded }"
    >
      <!-- header：折叠/展开共用同一元素 -->
      <div class="mm-evidence-header">
        <div class="mm-evidence-header-left">
          <span class="mm-evidence-title">
            <span>参考资料</span>
            <span class="mm-evidence-count">({{ count }})</span>
          </span>
          <button
            class="mm-evidence-add-button"
            type="button"
            title="添加参考资料"
            aria-label="添加参考资料"
            @click.stop="openInsertPanel"
          >
            <AddIcon class="mm-evidence-add-icon" />
          </button>
        </div>

        <button
          class="mm-reference-collapse-toggle"
          type="button"
          :title="expanded ? '折叠' : '展开'"
          :aria-label="expanded ? '折叠参考资料' : '展开参考资料'"
          @click.stop="expanded ? collapse() : expand()"
        >
          <ChevronIcon :direction="expanded ? 'up' : 'down'" class="mm-reference-toggle-icon" />
        </button>
      </div>

      <!-- 折叠态：预览（可拖拽框选复制） -->
      <div
        v-if="!expanded"
        class="mm-evidence-preview"
        role="button"
        tabindex="0"
        @click="expand"
        @keydown.enter.prevent="expand"
        @keydown.space.prevent="expand"
        :title="collapsedTitle"
      >
        <div class="mm-evidence-preview-block">
          <span class="mm-evidence-preview-text">{{ collapsedPreviewText }}</span>
        </div>
      </div>

      <!-- 展开态：列表（超出 max-height 后只列表滚动） -->
      <div v-else class="mm-evidence-body">
        <div class="mm-evidence-list-scroll">
          <div class="mm-evidence-list">
            <template v-if="evidences.length > 0">
              <div v-for="e in evidences" :key="e.id" class="mm-evidence-item">
                <button
                  class="mm-evidence-item-delete"
                  type="button"
                  title="删除"
                  aria-label="删除参考资料"
                  @click="remove(e.id)"
                >
                  <CloseIcon class="mm-evidence-item-delete-icon" />
                </button>
                <div class="mm-evidence-item-title">{{ e.title || '未命名参考资料' }}</div>
                <div v-if="e.containerTitle" class="mm-evidence-item-container-title">{{ e.containerTitle }}</div>
                <div v-if="e.snippet" class="mm-evidence-item-snippet">{{ e.snippet }}</div>
              </div>
            </template>
            <div v-else-if="loading" class="mm-evidence-item mm-evidence-item-placeholder">
              <div class="mm-evidence-item-title">加载中...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MindMapInstance } from '../../../domain/types'
import { useMindMapEvidenceStore } from '../domain/store/evidenceStore'
import {
  AddIcon,
  ChevronIcon,
  CloseIcon,
} from '@linnya/renderer-ui/icons'

interface Props {
  mind: MindMapInstance
  nodeId: string
}

const props = defineProps<Props>()

const evidenceStore = useMindMapEvidenceStore()

/**
 * 引用块宽度跟随节点“文本区域”的宽度，直到达到上限。
 *
 * 中文说明（实现动机）：
 * - 之前 `.mm-evidence-container` 是 inline-block + width:auto，因此会按自身内容收敛，
 *   结果是：节点变宽（比如 topic 更长）时，引用块不会同步变宽，折叠预览会更早出现省略号。
 * - 但如果直接用“节点整体宽度”来驱动引用块宽度，会产生循环依赖：引用块本身变宽会反过来撑大节点，
 *   从而导致节点在 topic 变短时无法缩回去。
 * - 因此这里选择跟随 `mm-topic > .text` 的布局宽度（offsetWidth），既能随 topic 变宽/变窄，
 *   又不会被引用块自身锁死宽度。
 *
 * 注意：
 * - 使用 offsetWidth（布局宽度）而不是 getBoundingClientRect（受缩放 transform 影响），
 *   避免缩放时出现“越跟越小/越跟越大”的比例误差。
 */
const rootEl = ref<HTMLElement | null>(null)
const followWidthPx = ref<number | null>(null)

const evidenceContainerStyle = computed(() => {
  const w = followWidthPx.value
  if (!w) return {}
  return { width: `${w}px` }
})

function getTopicTextElementFromRoot(root: HTMLElement): HTMLElement | null {
  const topicCandidate = root.closest('mm-topic')
  if (!topicCandidate) return null
  if (!(topicCandidate instanceof HTMLElement)) return null
  // 优先取直接子元素 `.text`，避免把 addons 一起算进去导致循环依赖
  const directText = topicCandidate.querySelector<HTMLElement>(':scope > .text')
  if (directText) return directText
  // 兜底：若结构变化没有 `.text`，退化为 topic 自身（可能存在轻微循环，但比空行为更可用）
  return topicCandidate
}

function computeFollowWidthPx(measureEl: HTMLElement): number | null {
  const raw = Math.ceil(measureEl.offsetWidth)
  if (!Number.isFinite(raw) || raw <= 0) return null
  // 中文说明：节点本身在全局样式里有 max-width（见 mindmap.css 的 mm-topic），这里不再额外硬编码 300px 上限。
  return raw
}

let resizeObserver: ResizeObserver | null = null
let observedEl: HTMLElement | null = null

function teardownFollowWidthObserver() {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  observedEl = null
}

async function setupFollowWidthObserver() {
  teardownFollowWidthObserver()
  await nextTick()

  const root = rootEl.value
  if (!root) return

  // 中文说明：尝试查找 measureEl，如果找不到，重试几次（应对 DOM 挂载/Teleport 时序问题）
  // 尤其是 AI 动态生成节点并挂载证据时，mm-topic 可能尚未完全渲染就绪
  let measureEl = getTopicTextElementFromRoot(root)
  if (!measureEl) {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      measureEl = getTopicTextElementFromRoot(root)
      if (measureEl) break
    }
  }

  if (!measureEl) return

  observedEl = measureEl

  const update = () => {
    if (!observedEl) return
    const val = computeFollowWidthPx(observedEl)
    // 中文说明（根因修复）：
    // 只有当 val 有效时才更新，避免在侧边栏动画/布局调整瞬间因获取到 0 而重置为 null。
    // 若重置为 null，样式会回退到 width: auto，导致 min-width: 220px 生效，
    // 从而在短节点上出现“溢出/变宽”的视觉 bug。
    if (val !== null) {
      if (followWidthPx.value !== val) {
        followWidthPx.value = val
        // 中文说明（根因修复：消除首屏视口偏移）：
        // - 引用块宽度变化会反过来影响节点总宽度（通过 min-width/max-width 约束）；
        // - 这种变化是 ResizeObserver 异步触发的，可能发生在 addons:content reflow 之后；
        // - 如果不再次触发 reflow，MindMap 引擎会按旧尺寸计算连线/中心点，导致首屏 scaleFit/toCenter 计算偏差；
        // - 因此当宽度发生实质变化时，必须请求一次 reflow。
        props.mind.requestReflow('addons:content')
      }
    }
  }

  // 初始化一次
  update()

  resizeObserver = new ResizeObserver(() => {
    update()
  })
  resizeObserver.observe(measureEl)
}

const countKnown = computed(() => evidenceStore.isCountKnown(props.nodeId))
const count = computed(() => evidenceStore.getCount(props.nodeId) ?? 0)
const evidences = computed(() => evidenceStore.getList(props.nodeId) ?? [])
const expanded = computed(() => evidenceStore.expandedByNodeId[props.nodeId] === true)
const previewItem = computed(() => evidences.value[0] ?? null)

const shouldShowPreview = computed(() => countKnown.value && count.value > 0)

const loading = computed(() => evidenceStore.getListStatus(props.nodeId) === 'loading')
const listStatus = computed(() => evidenceStore.getListStatus(props.nodeId))

/**
 * 折叠态预览文本（最多一行）
 *
 * 中文说明：
 * - 我们现在会在折叠态首次出现时主动 load list（见下方 watch），保证“初次打开”也能有预览文字。
 * - 但 list 拉取是异步的，短暂的 loading 窗口仍可能没有 previewItem。
 * - 为了保证折叠态永远只有一种外观，这里提供稳定的一行占位文本（加载中/提示点击展开）。
 */
const collapsedPreviewText = computed(() => {
  const item = previewItem.value
  if (!item) return loading.value ? '加载中...' : '点击展开查看参考资料'
  const title = (item.title ?? '').trim() || '未命名参考资料'
  const snippet = (item.snippet ?? '').trim()
  const containerTitle = (item.containerTitle ?? '').trim()
  return snippet ? `${title} — ${snippet}` : (containerTitle ? `${title} · ${containerTitle}` : title)
})

const collapsedTitle = computed(() => {
  const preview = collapsedPreviewText.value
  if (preview) return `点击展开参考资料（共 ${count.value} 条）：${preview}`
  return `点击展开参考资料（共 ${count.value} 条）`
})

async function ensureLoaded() {
  await evidenceStore.loadEvidences(props.nodeId)
}

/**
 * 初次打开也加载 list（只对“当前需要渲染折叠预览”的节点生效）
 *
 * 中文说明（根因修复）：
 * - 之前只有 count，list 默认不加载，导致折叠态预览行可能没有文字，看起来像“两种折叠样式”
 * - 这里在折叠预览首次出现时，若 listStatus 仍是 unknown，则主动拉取一次
 */
watch(
  () => [shouldShowPreview.value, listStatus.value] as const,
  async ([shouldPreview, status]) => {
    if (!shouldPreview) return
    if (status !== 'unknown') return
    await ensureLoaded()
  },
  { immediate: true }
)

async function relayout(reason: 'addons:toggle' | 'addons:content') {
  await nextTick()
  props.mind.requestReflow(reason)
}

async function expand() {
  evidenceStore.setNodeExpanded(props.nodeId, true)
  // 中文说明：若 list 已 loaded/empty，则展开不再重复 load，避免 loading 态导致 UI 抖动
  const shouldLoad = listStatus.value === 'unknown' || listStatus.value === 'error'
  const loadPromise = shouldLoad ? ensureLoaded() : Promise.resolve()
  await relayout('addons:toggle')
  await loadPromise
  if (shouldLoad) {
    await relayout('addons:content')
  }
}

async function collapse() {
  evidenceStore.setNodeExpanded(props.nodeId, false)
  await relayout('addons:toggle')
}

async function remove(evidenceId: string) {
  await evidenceStore.removeEvidence(evidenceId, props.nodeId)
  if (count.value > 0) {
    await ensureLoaded()
    await relayout('addons:content')
  }
}

function openInsertPanel() {
  props.mind.bus.fire('ui:openReferenceInsertPanel', {
    nodeId: props.nodeId,
    nodeTopic: props.mind.getObjById(props.nodeId, props.mind.nodeData)?.topic || '',
  })
}

// 中文说明：如果外部把 expanded 置为 true（例如插入引用后），这里确保加载一次，避免展开空列表
watch(
  () => [countKnown.value, count.value, expanded.value] as const,
  ([known, newCount, isExpanded]) => {
    /**
     * 自动折叠条件（根因修复）
     *
     * 中文说明：
     * - 旧逻辑：只要 count===0 且 expanded=true 就 collapse
     * - 但在 reload/AutoRefresh 时，count 会短暂进入 unknown/loading：
     *   - evidenceStore.getCount() 返回 null
     *   - 这里的 count 计算属性会退化成 0
     *   - 从而误触发 collapse，把用户手动展开的引用“自动关回去”
     *
     * 因此必须严格限定：只有当 count 已知（known=true）且确认为 0 时才允许自动折叠。
     */
    if (!known) return
    if (!isExpanded) return
    if (newCount !== 0) return
    collapse()
  }
)

watch(
  () => expanded.value,
  async (isExpanded) => {
    if (!isExpanded) return
    if (evidences.value.length > 0) return
    if (!countKnown.value || count.value <= 0) return
    await ensureLoaded()
    await relayout('addons:content')
  },
  { immediate: true }
)

onMounted(() => {
  setupFollowWidthObserver()
})

onBeforeUnmount(() => {
  teardownFollowWidthObserver()
})
</script>
