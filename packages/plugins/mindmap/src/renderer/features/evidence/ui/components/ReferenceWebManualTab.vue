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
        <span class="source-type-label">网页引用</span>
      </CustomRadio>
      <CustomRadio
        :model-value="sourceType"
        value="manual"
        name="sourceType"
        @update:model-value="handleSourceTypeChange"
      >
        <span class="source-type-label">手动输入</span>
      </CustomRadio>
    </div>

    <!-- 表单 -->
    <div class="form-section">
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
          {{ store.webManualErrors.url }}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label required">标题</label>
        <input
          ref="titleInputRef"
          :value="store.webManualForm.title"
          type="text"
          class="form-input"
          :class="{ error: store.webManualErrors.title }"
          placeholder="文章或资料的标题"
          @input="handleFieldChange('title', ($event.target as HTMLInputElement).value)"
        />
        <div v-if="store.webManualErrors.title" class="form-error">
          {{ store.webManualErrors.title }}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">作者</label>
        <input
          :value="store.webManualForm.authors"
          type="text"
          class="form-input"
          placeholder="多个作者用逗号分隔"
          @input="handleFieldChange('authors', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="form-group">
        <label class="form-label">年份</label>
        <input
          :value="store.webManualForm.date"
          type="text"
          class="form-input"
          placeholder="例如：2024"
          @input="handleFieldChange('date', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="form-group">
        <label class="form-label">出处</label>
        <input
          :value="store.webManualForm.containerTitle"
          type="text"
          class="form-input"
          placeholder="期刊名、书名或网站名"
          @input="handleFieldChange('containerTitle', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="form-group">
        <label class="form-label">引用片段</label>
        <textarea
          :value="store.webManualForm.snippet"
          class="form-textarea"
          placeholder="可选：引用的具体内容片段"
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
        重置
      </button>
      <button
        class="insert-btn"
        :disabled="!store.canInsertWebCitation"
        @click="handleInsert"
      >
        插入引用
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMindMapReferenceInsertStore } from '../../domain/store/referenceInsertStore'
import {
  useWebManualCitationForm,
  validateWebManualForm,
  type WebManualFormInput,
} from '@plugin/renderer/referenceRuntime'
import { CustomRadio } from '@linnya/renderer-ui'

const emit = defineEmits<{
  insert: [form: WebManualFormInput]
}>()

const store = useMindMapReferenceInsertStore()
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
  // 校验表单（复用 editor/citation 的校验规则，保证同款行为）
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

  emit('insert', { ...store.webManualForm })
}
</script>
