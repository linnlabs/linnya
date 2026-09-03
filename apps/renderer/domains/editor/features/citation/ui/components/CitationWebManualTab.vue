<template>
  <div class="web-manual-citation-form citation-web-manual-tab">
    <!-- 来源类型切换 -->
    <div class="source-type-section">
      <CustomRadio
        :model-value="sourceType"
        value="web"
        name="sourceType"
        @update:model-value="handleSourceTypeChange"
      >
        <span class="source-type-label">{{ editorMessage('editor.citation.form.webSource') }}</span>
      </CustomRadio>
      <CustomRadio
        :model-value="sourceType"
        value="manual"
        name="sourceType"
        @update:model-value="handleSourceTypeChange"
      >
        <span class="source-type-label">{{ editorMessage('editor.citation.form.manualSource') }}</span>
      </CustomRadio>
    </div>

    <!-- 表单 -->
    <div class="form-section">
      <!-- URL（网页引用时显示） -->
      <div v-if="!store.webManualForm.isManual" class="form-group">
        <label class="form-label required">URL</label>
        <input
          ref="urlInputRef"
          :value="store.webManualForm.url"
          type="text"
          class="form-input"
          :class="{ error: store.webManualErrors.url }"
          placeholder="https://example.com/article"
          @input="handleFieldChange('url', ($event.target as HTMLInputElement).value)"
        />
        <div v-if="store.webManualErrors.url" class="form-error">
          {{ resolvedWebManualErrors.url }}
        </div>
      </div>

      <!-- 标题 -->
      <div class="form-group">
        <label class="form-label required">{{ editorMessage('editor.citation.form.title') }}</label>
        <input
          ref="titleInputRef"
          :value="store.webManualForm.title"
          type="text"
          class="form-input"
          :class="{ error: store.webManualErrors.title }"
          :placeholder="editorMessage('editor.citation.form.titlePlaceholder')"
          @input="handleFieldChange('title', ($event.target as HTMLInputElement).value)"
        />
        <div v-if="store.webManualErrors.title" class="form-error">
          {{ resolvedWebManualErrors.title }}
        </div>
      </div>

      <!-- 作者 -->
      <div class="form-group">
        <label class="form-label">{{ editorMessage('editor.citation.form.authors') }}</label>
        <input
          :value="store.webManualForm.authors"
          type="text"
          class="form-input"
          :placeholder="editorMessage('editor.citation.form.authorsPlaceholder')"
          @input="handleFieldChange('authors', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- 年份 -->
      <div class="form-group">
        <label class="form-label">{{ editorMessage('editor.citation.form.year') }}</label>
        <input
          :value="store.webManualForm.date"
          type="text"
          class="form-input"
          :placeholder="editorMessage('editor.citation.form.yearPlaceholder')"
          @input="handleFieldChange('date', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- 容器标题（期刊名等） -->
      <div class="form-group">
        <label class="form-label">{{ editorMessage('editor.citation.form.container') }}</label>
        <input
          :value="store.webManualForm.containerTitle"
          type="text"
          class="form-input"
          :placeholder="editorMessage('editor.citation.form.containerPlaceholder')"
          @input="handleFieldChange('containerTitle', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- 引用片段 -->
      <div class="form-group">
        <label class="form-label">{{ editorMessage('editor.citation.form.snippet') }}</label>
        <textarea
          :value="store.webManualForm.snippet"
          class="form-textarea"
          :placeholder="editorMessage('editor.citation.form.snippetPlaceholder')"
          ref="snippetTextareaRef"
          rows="1"
          @input="handleSnippetInput"
        />
      </div>
    </div>

    <!-- 操作区 -->
    <div class="action-section">
      <button
        class="reset-btn"
        @click="handleReset"
      >
        {{ editorMessage('editor.citation.form.reset') }}
      </button>
      <button
        class="insert-btn"
        :disabled="!store.canInsertWebCitation"
        @click="handleInsert"
      >
        {{ editorMessage('editor.citation.form.insert') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file citation/ui/components/CitationWebManualTab.vue
 * @description Web/Manual 引用表单 Tab 组件（Phase 2）
 *
 * 职责：
 * - 提供 Web（URL）与 Manual（手动）两种来源切换
 * - 收集表单数据
 * - 校验并提交
 */

import { useCitationPanelStore } from '../../store/useCitationPanelStore'
import { validateWebManualForm, type WebManualFormInput } from '../../adapters/webCitationAdapter'
import { useWebManualCitationForm } from '../useWebManualCitationForm'
import { CustomRadio } from '@linnya/renderer-ui'
import { computed } from 'vue'
import { useEditorLocalization } from '../../../../ui/useEditorLocalization'
import { resolveCitationValidationErrorMap } from '../../functions/citationPresentation'

const emit = defineEmits<{
  insert: [form: WebManualFormInput]
}>()

const store = useCitationPanelStore()
const { editorMessage } = useEditorLocalization()
const resolvedWebManualErrors = computed(() => {
  return resolveCitationValidationErrorMap(store.webManualErrors, editorMessage)
})
const {
  sourceType,
  urlInputRef,
  titleInputRef,
  snippetTextareaRef,
  handleSourceTypeChange,
  handleFieldChange,
  handleSnippetInput,
  handleReset,
} = useWebManualCitationForm(store)

function handleInsert() {
  // 校验表单
  const errors = validateWebManualForm(store.webManualForm)

  // 设置错误
  for (const field of Object.keys(errors) as Array<keyof WebManualFormInput>) {
    const errorMsg = errors[field]
    if (errorMsg) {
      store.setWebManualError(field, errorMsg)
    }
  }

  // 如果有错误，不提交
  if (Object.keys(errors).length > 0) {
    return
  }

  // 提交
  emit('insert', { ...store.webManualForm })
}
</script>
