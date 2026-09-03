<!--
  CitationEditPanel.vue
  
  引用编辑面板
  
  职责：
  - 编辑引用元数据（标题/作者/年份/容器/url/snippet）
  - 保存时批量更新同源引用（同 sourceId）
  
  设计说明：
  - 复用 DraggablePanel 组件
  - 本项目 Phase 3 不提供"仅更新当前"选项
  - 保存即执行同源全量更新
-->

<template>
  <DraggablePanel
    :visible="visible"
    width="520px"
    height="auto"
    initial-position="center"
    :class-names="{ body: 'citation-edit-panel-body' }"
    @close="handleClose"
  >
    <template #title>{{ editorMessage('editor.citation.edit.title') }}</template>
    <div class="citation-edit-form">
      <!-- 标题（必填） -->
      <div class="form-row">
        <label class="form-label required">{{ editorMessage('editor.citation.form.title') }}</label>
        <div class="control-area">
          <input
            v-model="formData.title"
            type="text"
            class="form-input"
            :placeholder="editorMessage('editor.citation.form.titlePlaceholder')"
          />
          <span v-if="errors.title" class="form-error">{{ errors.title }}</span>
        </div>
      </div>

      <!-- 作者 -->
      <div class="form-row">
        <label class="form-label">{{ editorMessage('editor.citation.form.authors') }}</label>
        <div class="control-area">
          <input
            v-model="formData.authors"
            type="text"
            class="form-input"
            :placeholder="editorMessage('editor.citation.form.authorsPlaceholder')"
          />
          <span class="form-hint">{{ editorMessage('editor.citation.form.authorsHint') }}</span>
        </div>
      </div>

      <!-- 年份/日期 -->
      <div class="form-row">
        <label class="form-label">{{ editorMessage('editor.citation.form.yearDate') }}</label>
        <div class="control-area">
          <div class="date-control-row">
            <input
              v-model="formData.date"
              type="text"
              class="form-input"
              :placeholder="editorMessage('editor.citation.form.yearDatePlaceholder')"
            />
            <!--
              中文说明：
              - 复用统一的日期选择组件（SimpleDatePicker）
              - 仍保留文本输入：支持“仅年份（2024）”这类输入，不强行改成完整日期
              - 当选择器选中日期时，会写回 formData.date 为 YYYY-MM-DD
            -->
            <SimpleDatePicker
              v-model="datePickerValue"
              :placeholder="editorMessage('editor.citation.form.datePickerPlaceholder')"
              :class-names="{ trigger: 'citation-edit-date-picker-trigger' }"
            />
          </div>
        </div>
      </div>

      <!-- 容器标题（期刊名等） -->
      <div class="form-row">
        <label class="form-label">{{ editorMessage('editor.citation.form.containerEdit') }}</label>
        <div class="control-area">
          <input
            v-model="formData.containerTitle"
            type="text"
            class="form-input"
            :placeholder="editorMessage('editor.citation.form.containerPlaceholder')"
          />
        </div>
      </div>

      <!-- 链接（可选；web/manual/知识库都允许） -->
      <div class="form-row">
        <label class="form-label">{{ editorMessage('editor.citation.form.url') }}</label>
        <div class="control-area">
          <input v-model="formData.url" type="url" class="form-input" placeholder="https://..." />
          <span class="form-hint">{{ editorMessage('editor.citation.form.urlHint') }}</span>
        </div>
      </div>

      <!-- 引用片段 -->
      <div class="form-row input-row">
        <label class="form-label">{{ editorMessage('editor.citation.form.snippet') }}</label>
        <div class="control-area">
          <textarea
            ref="snippetTextareaRef"
            v-model="formData.snippet"
            class="form-textarea"
            rows="1"
            :placeholder="editorMessage('editor.citation.form.snippetEditPlaceholder')"
            @input="handleSnippetInput"
          ></textarea>
        </div>
      </div>

      <!-- 同源引用提示 -->
      <div v-if="sameSourceCount > 1" class="same-source-notice">
        <!-- 注意：这里直接使用 SVG，避免 runtime template compilation 警告 -->
        <svg
          class="notice-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>{{ formatCitationSameSourceNotice(sameSourceCount, editorMessage) }}</span>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <ActionButtons
          :secondary-action-text="editorMessage('editor.citation.form.cancel')"
          :primary-action-text="editorMessage('editor.citation.form.save')"
          :is-primary-action-disabled="!canSave"
          @secondary-click="handleClose"
          @primary-click="handleSave"
        />
      </div>
    </div>
  </DraggablePanel>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import {
  ActionButtons,
  DraggablePanel,
  SimpleDatePicker,
  applyTextareaAutoResize,
} from '@linnya/renderer-ui'
import { useUIStore } from '@/shared/stores/ui'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import {
  citationUpdateService,
  type CitationSourceUpdateData,
} from '../services/citationUpdateService'
import type { CitationSourceType, CitationNodeAttrs } from '../types'
import {
  formatCitationSameSourceNotice,
  resolveCitationValidationError,
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
  /** 初始数据 */
  initialData: CitationNodeAttrs | null
}

const props = defineProps<Props>()

// ============ Emits ============

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', count: number): void
}>()

// ============ State ============

const uiStore = useUIStore()
const { editorMessage } = useEditorLocalization()

/** 表单数据 */
const formData = ref({
  title: '',
  authors: '',
  date: '',
  containerTitle: '',
  url: '',
  snippet: '',
})

/** 引用片段 textarea：自动高度控制 */
const snippetTextareaRef = ref<HTMLTextAreaElement | null>(null)

/**
 * 日期选择器的绑定值（Date | null）
 * 中文说明：date 字段本质上仍是字符串（支持“年份/日期”混合格式），选择器只是辅助填写 YYYY-MM-DD。
 */
const datePickerValue = ref<Date | null>(null)

/** 表单错误 */
const errors = ref<Record<string, string>>({})

/** 同源引用数量 */
const sameSourceCount = ref(0)

// ============ Computed ============

/** 是否可以保存 */
const canSave = computed(() => {
  return formData.value.title.trim().length > 0
})

// ============ 初始化 ============

function initFormData() {
  if (props.initialData) {
    formData.value = {
      title: props.initialData.title || '',
      authors: props.initialData.authors?.join(', ') || '',
      date: props.initialData.date || '',
      containerTitle: props.initialData.containerTitle || '',
      url: props.initialData.url || '',
      snippet: props.initialData.snippet || '',
    }
  } else {
    formData.value = {
      title: '',
      authors: '',
      date: '',
      containerTitle: '',
      url: '',
      snippet: '',
    }
  }
  errors.value = {}
}

function updateSameSourceCount() {
  const editor = uiStore.getEditor()
  if (!editor || !props.sourceId) {
    sameSourceCount.value = 0
    return
  }

  sameSourceCount.value = citationUpdateService.countCitationsBySourceId(
    editor.state.doc,
    props.sourceId
  )
}

// ============ 事件处理 ============

function handleClose() {
  emit('close')
}

/**
 * 自动调整“引用片段”高度（自动撑高 + 最大高度）
 *
 * 中文说明：
 * - 用户不需要手动拖拽调整高度（因此 CSS 禁用 resize）
 * - 通过 scrollHeight 自动撑高，超过最大高度后转为内部滚动
 */
function autoResizeSnippetTextarea() {
  const el = snippetTextareaRef.value
  if (!el) return

  applyTextareaAutoResize(el, { maxHeight: 200 })
}

function handleSnippetInput() {
  // v-model 已更新，等 DOM 更新后再计算高度
  nextTick(() => autoResizeSnippetTextarea())
}

/**
 * 解析 formData.date（字符串）到 Date（仅在明确是日期时才解析）
 * 支持格式：
 * - YYYY-MM-DD
 * - YYYY-MM（会按当月 1 号显示）
 *
 * 不解析 YYYY（避免把“年份”误显示成 1 月 1 日）
 */
function parseDateStringToDate(input: string): Date | null {
  const s = input.trim()
  if (!s) return null

  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) {
    const year = Number(ymd[1])
    const month = Number(ymd[2])
    const day = Number(ymd[3])
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
    const d = new Date(year, month - 1, day)
    // 校验防止 2024-02-31 被 JS 自动纠正
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
    return d
  }

  const ym = s.match(/^(\d{4})-(\d{2})$/)
  if (ym) {
    const year = Number(ym[1])
    const month = Number(ym[2])
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null
    if (month < 1 || month > 12) return null
    return new Date(year, month - 1, 1)
  }

  return null
}

function formatDateToYmd(date: Date): string {
  const y = date.getFullYear().toString()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${d}`
}

function handleSave() {
  // 验证
  errors.value = {}
  if (!formData.value.title.trim()) {
    errors.value.title = resolveCitationValidationError('titleRequired', editorMessage)
    return
  }

  const editor = uiStore.getEditor()
  if (!editor) {
    console.error('[CitationEditPanel] editor 实例不存在')
    return
  }

  // 构造“同源可同步字段”的更新数据
  const sourceUpdateData: CitationSourceUpdateData = {
    title: formData.value.title.trim(),
  }

  // 处理作者列表
  if (formData.value.authors.trim()) {
    sourceUpdateData.authors = formData.value.authors
      .split(/[,，]/)
      .map(a => a.trim())
      .filter(a => a.length > 0)
  } else {
    sourceUpdateData.authors = []
  }

  /**
   * 可选字段（支持清空）
   *
   * 中文说明：
   * - 之前仅在“非空”时才写回，导致用户把字段清空后保存不会生效（旧值残留）
   * - 这里统一写回 trim 后的字符串（可能为空字符串），从根因上保证“清空=真的清空”
   */
  sourceUpdateData.date = formData.value.date.trim()
  sourceUpdateData.containerTitle = formData.value.containerTitle.trim()
  sourceUpdateData.url = formData.value.url.trim()

  // 执行批量更新
  const updatedCount = citationUpdateService.updateCitationsBySourceId(
    editor,
    props.sourceId,
    sourceUpdateData
  )

  // 引用片段：只更新当前 citationId（避免不同位置引用片段互相覆盖）
  const snippetUpdated = citationUpdateService.updateCitationSnippetByCitationId(
    editor,
    props.citationId,
    formData.value.snippet
  )

  console.log(
    `[CitationEditPanel] 已更新 ${updatedCount} 处同源引用（基础信息）；snippet 当前引用更新=${snippetUpdated}`
  )

  emit('saved', updatedCount)
  emit('close')
}

// ============ Watch ============

watch(
  () => props.visible,
  newVisible => {
    if (newVisible) {
      initFormData()
      updateSameSourceCount()
      nextTick(() => autoResizeSnippetTextarea())
    }
  },
  { immediate: true }
)

watch(
  () => props.initialData,
  () => {
    if (props.visible) {
      initFormData()
      nextTick(() => autoResizeSnippetTextarea())
    }
  }
)

// 同步：文本 -> datePickerValue
watch(
  () => formData.value.date,
  val => {
    datePickerValue.value = parseDateStringToDate(val)
  },
  { immediate: true }
)

// 同步：datePickerValue -> 文本（只在选择器明确给了日期时写回）
watch(datePickerValue, val => {
  if (!val) return
  formData.value.date = formatDateToYmd(val)
})
</script>
