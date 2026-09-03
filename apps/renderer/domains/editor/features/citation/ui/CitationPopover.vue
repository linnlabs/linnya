<!--
  CitationPopover.vue
  
  引用悬浮卡片
  
  职责：
  - 当用户 hover/click 引用时显示
  - 展示标题/年份 + snippet
  - 提供"编辑引用"等操作入口
  
  设计说明：
  - 使用 Teleport + fixed 定位（参考 RevisionMarkPopup.vue）
  - 通过 store 控制显示状态和位置
-->

<template>
  <Teleport to="body">
    <!--
      中文说明：
      - Popover 的出现/消失需要过渡动画（淡入淡出 + 轻微位移），体验更自然
      - 使用 <Transition> 包裹 v-if，确保 enter/leave 都能生效
    -->
    <Transition name="editor-citation-popover">
      <div
        v-if="visible"
        ref="popoverRef"
        class="editor-citation-popover"
        :style="popoverStyle"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
      >
        <!-- 头部：标题 + 年份 -->
        <div class="popover-header">
          <span class="popover-title">{{ title }}</span>
          <span v-if="date" class="popover-date">{{ formatDate(date) }}</span>
        </div>

        <!-- 作者（如果有） -->
        <div v-if="authors && authors.length > 0" class="popover-authors">
          {{ formatAuthors(authors) }}
        </div>

        <!-- 内容：snippet（支持多段） -->
        <div v-if="snippetBlocks.length > 0" class="popover-body">
          <div
            v-for="(block, idx) in snippetBlocks"
            :key="idx"
            class="popover-snippet-block"
          >
            <!--
              中文说明：
              - 段与段之间使用“非满宽横线”分隔（左右留空隙），而不是直接用 margin-top 拉开
              - 横线只负责分隔；文本块本身保持原有排版
            -->
            <div v-if="idx > 0" class="popover-snippet-divider" aria-hidden="true"></div>
            <div class="popover-snippet">{{ block }}</div>
          </div>
        </div>

        <!-- 来源标识 -->
        <div class="popover-source">
          <span class="source-badge" :class="sourceType">
            {{ sourceTypeLabel }}
          </span>
        </div>

        <!-- 底部操作栏 -->
        <div class="popover-footer">
          <!-- 跳转来源（仅 KB 来源且文档存在时） -->
          <button
            v-if="sourceType === 'knowledge_base'"
            class="popover-btn"
            :title="editorMessage('editor.citation.popover.jumpToSourceTitle')"
            @click="handleJumpToSource"
          >
            <!--
              中文说明：
              - "查看来源"按钮统一使用 Renderer UI 包的 SourceIcon
              - 避免每个地方各自内联一份 SVG，后续主题/尺寸统一更容易维护
            -->
            <SourceIcon class="btn-icon" />
            <span>{{ editorMessage('editor.citation.popover.viewSource') }}</span>
          </button>

          <!-- 打开链接（仅 web 来源） -->
          <button
            v-if="sourceType === 'web' && url"
            class="popover-btn"
            :title="editorMessage('editor.citation.popover.openUrlTitle')"
            @click="handleOpenUrl"
          >
            <SourceIcon class="btn-icon" />
            <span>{{ editorMessage('editor.citation.popover.openLink') }}</span>
          </button>

          <!-- 编辑引用 -->
          <button
            class="popover-btn primary"
            :title="editorMessage('editor.citation.popover.editTitle')"
            @click="handleEdit"
          >
            <!--
              中文说明：
              - “编辑引用”按钮统一使用 Renderer UI 包的 EditIcon
              - 避免每个地方各自内联一份 SVG，后续主题/尺寸统一更容易维护
            -->
            <EditIcon class="btn-icon" />
            <span>{{ editorMessage('editor.citation.popover.edit') }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { CitationSourceType } from '../types'
import { EditIcon } from '@linnya/renderer-ui/icons';
import { SourceIcon } from '@linnya/renderer-ui/icons';
import { openExternalUrl } from '@/shared/utils/openExternalUrl'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import {
  formatCitationAuthors,
  formatCitationDate,
  resolveCitationSourceTypeLabel,
} from '../functions/citationPresentation'

// ============ Props ============

interface Props {
  /** 是否显示 */
  visible: boolean
  /** 引用实例 ID */
  citationId: string
  /** 来源 ID */
  sourceId: string
  /** 来源类型 */
  sourceType: CitationSourceType
  /** 标题 */
  title: string
  /** 引用片段 */
  snippet: string
  /** 多段引用片段（可选） */
  snippets?: string[]
  /** 作者列表 */
  authors?: string[]
  /** 日期 */
  date?: string
  /** URL */
  url?: string
  /** 弹出位置 */
  position: { top: number; left: number }
  /**
   * 是否“固定显示”
   *
   * 中文说明：
   * - true：点击引用后固定显示，直到用户发生外部点击/键入/其它主动交互才关闭
   * - false：用于 hover 预览（可选），允许 mouseleave 自动关闭
   */
  pinned?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  snippets: () => [],
  authors: () => [],
  date: '',
  url: '',
  pinned: false,
})
const { editorMessage } = useEditorLocalization()

// ============ Emits ============

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit', citationId: string, sourceId: string): void
  (e: 'jump-to-source', sourceId: string): void
}>()

// ============ State ============

const popoverRef = ref<HTMLElement | null>(null)
/** 鼠标是否在 popover 内 */
const isMouseInside = ref(false)

// ============ Computed ============

/** 来源类型标签 */
const sourceTypeLabel = computed(() => {
  return resolveCitationSourceTypeLabel(props.sourceType, editorMessage)
})

/** 计算弹出位置（考虑边界） */
const popoverStyle = computed(() => {
  const POPOVER_WIDTH = 320
  const POPOVER_MAX_HEIGHT = 300
  const MARGIN = 12
  /**
   * 中文说明：
   * - `CitationInteractionExtension` 传入的 position.top = 引用元素的 rect.bottom（视口坐标）
   * - 这里不要再额外加太大的偏移，否则会显得“离引用很远”
   */
  const OFFSET_Y = props.pinned ? 8 : 10

  let left = props.position.left
  let top = props.position.top + OFFSET_Y // 默认显示在下方（贴近引用）

  // 检查右边界
  if (left + POPOVER_WIDTH > window.innerWidth - MARGIN) {
    left = window.innerWidth - MARGIN - POPOVER_WIDTH
  }

  // 检查左边界
  if (left < MARGIN) {
    left = MARGIN
  }

  // 检查下边界，如果下方空间不足则显示在上方
  if (top + POPOVER_MAX_HEIGHT > window.innerHeight - MARGIN) {
    // 中文说明：position.top 是 rect.bottom，因此这里的上方定位会让 popover 的底部贴近引用（保留一个小间距）
    top = props.position.top - POPOVER_MAX_HEIGHT - OFFSET_Y
  }

  // 检查上边界
  if (top < MARGIN) {
    top = MARGIN
  }

  return {
    top: `${top}px`,
    left: `${left}px`,
    maxWidth: `${POPOVER_WIDTH}px`,
  }
})

/**
 * Popover 内展示的 snippet 分段
 *
 * 中文说明：
 * - 优先使用 `snippets`（相邻同源引用合并后生成）
 * - 否则回退到单段 `snippet`
 */
const snippetBlocks = computed(() => {
  const blocks: string[] = []
  if (Array.isArray(props.snippets) && props.snippets.length > 0) {
    for (const s of props.snippets) {
      if (typeof s === 'string' && s.trim().length > 0) {
        blocks.push(s)
      }
    }
  } else if (props.snippet && props.snippet.trim().length > 0) {
    blocks.push(props.snippet)
  }
  return blocks
})

// ============ 辅助函数 ============

/**
 * 格式化作者列表
 */
const formatAuthors = (authors: string[]): string => formatCitationAuthors(authors, editorMessage)

/**
 * 格式化日期（提取年份）
 */
const formatDate = formatCitationDate

// ============ 事件处理 ============

function handleMouseEnter() {
  isMouseInside.value = true
}

function handleMouseLeave() {
  isMouseInside.value = false
  // 中文说明：点击触发时需要固定显示，不应因为 mouseleave 自动关闭
  if (props.pinned) return

  // hover 模式：延迟关闭，给用户移动鼠标的时间
  setTimeout(() => {
    if (!isMouseInside.value) {
      emit('close')
    }
  }, 100)
}

function handleEdit() {
  emit('edit', props.citationId, props.sourceId)
}

function handleJumpToSource() {
  emit('jump-to-source', props.sourceId)
}

function handleOpenUrl() {
  if (props.url) {
    void openExternalUrl(props.url)
  }
}

// ============ 外部点击关闭 ============

/**
 * 判断事件是否来自 popover 内部
 * 中文说明：用于避免点击/键入发生在 popover 内部时误触发关闭
 */
function isEventFromPopover(event: Event): boolean {
  const el = popoverRef.value
  if (!el) return false
  const target = event.target
  if (!(target instanceof Node)) return false
  return el.contains(target)
}

function handleClickOutside(event: MouseEvent) {
  if (popoverRef.value && !isEventFromPopover(event)) {
    emit('close')
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    emit('close')
    return
  }

  /**
   * 中文说明：
   * - pinned=true 时，用户在编辑器里键入/操作键盘，属于“主动操作”，应关闭 popover
   * - 但如果焦点在 popover 内部（例如按钮），不应误关闭
   */
  if (props.pinned && !isEventFromPopover(event)) {
    // 过滤纯修饰键，避免用户只按下 Shift/Ctrl 等就触发关闭
    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') {
      return
    }
    emit('close')
  }
}

function handleBeforeInput(event: InputEvent) {
  // 中文说明：兼容 IME/输入法场景，beforeinput 比 keydown 更接近“实际输入发生”
  if (props.pinned && !isEventFromPopover(event)) {
    emit('close')
  }
}

function handlePaste(event: ClipboardEvent) {
  // 中文说明：粘贴也属于“主动编辑行为”，需要关闭 pinned popover
  if (props.pinned && !isEventFromPopover(event)) {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('beforeinput', handleBeforeInput as EventListener)
  document.addEventListener('paste', handlePaste)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('beforeinput', handleBeforeInput as EventListener)
  document.removeEventListener('paste', handlePaste)
})
</script>
