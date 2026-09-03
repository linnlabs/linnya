import { computed, nextTick, ref, watch } from 'vue'
import type { WebManualFormInput } from '../adapters/webCitationAdapter'
import { applyTextareaAutoResize } from '@linnya/renderer-ui'

/**
 * Web/Manual 引用表单 Store 适配器，是 Citation feature 暴露给 Renderer referenceRuntime 的公开 UI 合同。
 *
 * 中文说明：
 * - editor 与消费该端口的插件表单状态保持同构（visible/activeTab/webManualForm/...）；
 * - 用这个最小接口解耦具体 store，实现“同一套交互控制逻辑复用”。
 */
export interface WebManualCitationFormStoreAdapter {
  visible: boolean
  activeTab: string
  webManualForm: WebManualFormInput
  updateWebManualForm<K extends keyof WebManualFormInput>(
    field: K,
    value: WebManualFormInput[K]
  ): void
  setWebManualError(field: keyof WebManualFormInput, error: string | null): void
  resetWebManualForm(): void
}

/**
 * 复用 Web/Manual Tab 的交互控制逻辑
 *
 * 覆盖能力：
 * - 面板打开/切 tab 聚焦
 * - 来源类型切换
 * - 片段 textarea 自动高度
 * - 字段更新与重置
 */
export function useWebManualCitationForm(
  store: WebManualCitationFormStoreAdapter,
  activeTabId = 'web'
) {
  const urlInputRef = ref<HTMLInputElement | null>(null)
  const titleInputRef = ref<HTMLInputElement | null>(null)
  const snippetTextareaRef = ref<HTMLTextAreaElement | null>(null)

  const sourceType = computed(() => (store.webManualForm.isManual ? 'manual' : 'web'))

  function focusFirstInput() {
    if (store.webManualForm.isManual) {
      titleInputRef.value?.focus()
    } else {
      urlInputRef.value?.focus()
    }
  }

  function autoResizeSnippetTextarea() {
    const el = snippetTextareaRef.value
    if (!el) return

    applyTextareaAutoResize(el, { maxHeight: 160 })
  }

  function handleSourceTypeChange(type: 'web' | 'manual') {
    const isManual = type === 'manual'
    store.updateWebManualForm('isManual', isManual)
    if (isManual) {
      store.setWebManualError('url', null)
    }
    nextTick(() => focusFirstInput())
  }

  function handleFieldChange<K extends keyof WebManualFormInput>(
    field: K,
    value: WebManualFormInput[K]
  ) {
    store.updateWebManualForm(field, value)
  }

  function handleSnippetInput(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value
    handleFieldChange('snippet', value)
    nextTick(() => autoResizeSnippetTextarea())
  }

  function handleReset() {
    store.resetWebManualForm()
  }

  watch(
    () => store.visible,
    async (visible) => {
      if (visible && store.activeTab === activeTabId) {
        await nextTick()
        focusFirstInput()
        autoResizeSnippetTextarea()
      }
    }
  )

  watch(
    () => store.activeTab,
    async (tab) => {
      if (tab === activeTabId && store.visible) {
        await nextTick()
        focusFirstInput()
        autoResizeSnippetTextarea()
      }
    }
  )

  return {
    sourceType,
    urlInputRef,
    titleInputRef,
    snippetTextareaRef,
    handleSourceTypeChange,
    handleFieldChange,
    handleSnippetInput,
    handleReset,
  }
}
