<!--
  CitationBibliographyView.vue
  
  参考文献容器块的 NodeView 组件
  
  职责：
  - 从 citationRenderPlugin 的 state 读取派生的 entries
  - 根据 styleId 渲染参考文献列表
  - 响应 editor transaction 更新列表
  
  设计说明：
  - 使用 Teleport 避免 ProseMirror 的 contenteditable 影响
  - 监听 editor.on('transaction') 同步 plugin state 到 Vue ref
-->

<template>
  <node-view-wrapper
    class="bibliography-block-outer base-block-outer"
    data-node-type="bibliographyBlockOuter"
    contenteditable="false"
  >
    <!--
      中文说明：
      - BibliographyBlock 是 atom 系统块（schema: atom=true, selectable=true）
      - 在 ProseMirror 中，这类 NodeView 默认更倾向于“选中整个节点”，会打断浏览器的文本拖选
      - 这里对鼠标事件做 stopPropagation（不 preventDefault），让用户可以像普通文本一样拖选复制参考文献
    -->
    <div
      class="bibliography-block base-block editor-block"
      data-node-type="bibliographyBlock"
      :data-block-type="'bibliography'"
      :data-style-id="styleId"
      @mousedown.stop="handleStopProseMirrorMouseEvent"
      @mousemove.stop="handleStopProseMirrorMouseEvent"
      @mouseup.stop="handleStopProseMirrorMouseEvent"
      @click.stop="handleStopProseMirrorMouseEvent"
    >
      <!-- 标题 -->
      <div class="bibliography-title">{{ editorMessage('editor.citation.bibliography.title') }}</div>

      <!-- 条目列表 -->
      <ul v-if="entries.length > 0" class="bibliography-list">
        <li
          v-for="entry in entries"
          :key="entry.sourceId"
          class="bibliography-entry"
        >
          <!-- 编号（numeric 风格显示） -->
          <span
            v-if="styleId === 'numeric'"
            class="bibliography-entry-index"
          >
            [{{ entry.numericIndex }}]
          </span>

          <!-- 条目内容 -->
          <div class="bibliography-entry-content">
            <!-- 作者 -->
            <span
              v-if="entry.authors && entry.authors.length > 0"
              class="bibliography-entry-authors"
            >
              {{ formatAuthors(entry.authors) }}.
            </span>

            <!-- 标题 -->
            <span class="bibliography-entry-title">
              {{ entry.title }}
            </span>

            <!-- 容器标题（期刊名等） -->
            <span
              v-if="entry.containerTitle"
              class="bibliography-entry-container"
            >
              . {{ entry.containerTitle }}
            </span>

            <!-- 年份/日期 -->
            <span
              v-if="entry.date"
              class="bibliography-entry-date"
            >
              , {{ formatDate(entry.date) }}
            </span>

            <!-- URL -->
            <template v-if="entry.url">
              .
              <a
                :href="entry.url"
                class="bibliography-entry-url"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop
              >
                {{ truncateUrl(entry.url) }}
              </a>
            </template>
          </div>
        </li>
      </ul>

      <!-- 空状态 -->
      <div v-else class="bibliography-empty">
        {{ editorMessage('editor.citation.bibliography.empty') }}
      </div>

      <!-- 样式切换按钮（可选，放在右上角） -->
      <div class="bibliography-actions">
        <button
          class="bibliography-style-toggle"
          :title="styleToggleTitle"
          @click="toggleStyle"
        >
          <span class="style-label">{{ styleToggleLabel }}</span>
        </button>
      </div>
    </div>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import {
  type BibliographyEntry,
} from '../../render/citationDerivation'
import { getCitationDerivation, getCurrentStyleId } from '../../render/citationRenderPlugin'
import type { BibliographyStyleId } from '../../types'
import { useEditorLocalization } from '../../../../ui/useEditorLocalization'
import {
  formatCitationAuthors,
  formatCitationDate,
} from '../../functions/citationPresentation'

// ============ Props ============
// 使用 Tiptap 提供的 nodeViewProps 保证类型兼容

const props = defineProps(nodeViewProps)
const { editorMessage } = useEditorLocalization()

// ============ State ============

/** 当前样式 ID */
const styleId = ref<BibliographyStyleId>('numeric')

/** 参考文献条目列表 */
const entries = ref<BibliographyEntry[]>([])

const styleToggleTitle = computed(() => {
  return styleId.value === 'numeric'
    ? editorMessage('editor.citation.bibliography.switchToAuthorDate')
    : editorMessage('editor.citation.bibliography.switchToNumeric')
})

const styleToggleLabel = computed(() => {
  return styleId.value === 'numeric'
    ? '[1]'
    : editorMessage('editor.citation.bibliography.authorDateLabel')
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

/**
 * 截断 URL（显示用）
 */
function truncateUrl(url: string, maxLength = 50): string {
  if (url.length <= maxLength) return url
  return url.slice(0, maxLength) + '...'
}

/**
 * 从 editor state 同步数据到 Vue ref
 */
function syncFromPluginState() {
  if (!props.editor || props.editor.isDestroyed) return

  const state = props.editor.state
  const derivation = getCitationDerivation(state)
  const currentStyle = getCurrentStyleId(state)

  if (derivation) {
    entries.value = derivation.entries
  } else {
    entries.value = []
  }

  styleId.value = currentStyle
}

// ============ 事件处理 ============

/**
 * 阻止 ProseMirror 抢占 NodeView 内的鼠标事件
 *
 * 中文说明：
 * - BibliographyBlock 是 atom 系统块，PM 默认会把鼠标交互用于“选中节点”
 * - 这里通过 template 上的 `.stop` 修饰符阻断事件冒泡即可
 * - 该函数本身是 no-op，仅用于让模板事件绑定合法且可读
 */
function handleStopProseMirrorMouseEvent(_event: MouseEvent): void {
  // no-op
}

/**
 * 切换参考文献样式
 */
function toggleStyle() {
  const newStyleId: BibliographyStyleId = styleId.value === 'numeric' ? 'author-date' : 'numeric'
  
  // 更新 node attrs
  props.updateAttributes({ styleId: newStyleId })
}

/**
 * 处理 transaction（响应文档变化）
 */
function handleTransaction() {
  syncFromPluginState()
}

// ============ 生命周期 ============

onMounted(() => {
  // 初始同步
  syncFromPluginState()

  // 监听 transaction 更新
  props.editor.on('transaction', handleTransaction)
})

onBeforeUnmount(() => {
  // 移除监听
  props.editor.off('transaction', handleTransaction)
})

// 监听 node attrs 变化（styleId 可能被外部修改）
watch(
  () => props.node.attrs.styleId,
  (newStyleId) => {
    if (newStyleId && newStyleId !== styleId.value) {
      styleId.value = newStyleId as BibliographyStyleId
      // styleId 变化后需要重新派生（plugin 会自动处理）
      syncFromPluginState()
    }
  }
)
</script>

<!--
  中文说明：
  - BibliographyBlock 的视觉目标是“像正文一样”，所以这里直接复用 BaseBlock 的 class：
    - outer: base-block-outer（块间距/占位符等外层规则）
    - inner: base-block editor-block（正文排版/line-height 等内层规则）
  - bibliography 自己的细节样式统一放到全局的 citationRender.css，避免 scoped 与全局重复/打架。
-->
