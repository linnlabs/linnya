<template>
  <Modal
    :is-visible="true"
    :title="editorMessage('editor.chart.editor.title')"
    width="min(1120px, 94vw)"
    max-width="94vw"
    height="min(720px, 90dvh)"
    :close-on-esc="!changed"
    :close-on-overlay-click="!changed"
    @close="emit('cancel')"
  >
    <div class="chart-edit-modal">
      <section
        class="chart-edit-modal__pane"
        :aria-label="editorMessage('editor.chart.editor.source')"
      >
        <header class="chart-edit-modal__pane-header">
          <h3 class="chart-edit-modal__pane-title">
            {{ editorMessage('editor.chart.editor.source') }}
          </h3>
          <span
            class="chart-edit-modal__status"
            :class="statusClass"
            role="status"
          >{{ statusText }}</span>
        </header>
        <p class="chart-edit-modal__hint">
          {{ editorMessage('editor.chart.editor.hint') }}
        </p>
        <div
          ref="sourceHost"
          class="chart-edit-modal__source-host"
        >
          <CustomTextarea
            :model-value="sourceText"
            :rows="20"
            control-class="chart-edit-modal__source"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            :aria-label="editorMessage('editor.chart.editor.source')"
            :aria-invalid="evaluation.kind === 'invalid'"
            @update:model-value="setSource"
            @keydown="onSourceKeydown"
          />
        </div>
        <ul
          v-if="diagnostics.length > 0"
          class="chart-edit-modal__diagnostics"
        >
          <li
            v-for="(item, index) in diagnostics"
            :key="index"
            class="chart-edit-modal__diagnostic"
          >
            <code class="chart-edit-modal__diagnostic-path">{{ describeLocation(item) }}</code>
            <span class="chart-edit-modal__diagnostic-message">{{ item.message }}</span>
          </li>
        </ul>
      </section>

      <section
        class="chart-edit-modal__pane chart-edit-modal__pane--preview"
        :aria-label="editorMessage('editor.chart.editor.preview')"
      >
        <header class="chart-edit-modal__pane-header">
          <h3 class="chart-edit-modal__pane-title">
            {{ editorMessage('editor.chart.editor.preview') }}
          </h3>
        </header>
        <ChartSurface
          :spec="previewSpec"
          :reading-key="null"
          :transitions="false"
        />
        <p
          v-if="previewIsStale"
          class="chart-edit-modal__stale"
        >
          {{ editorMessage('editor.chart.editor.previewStale') }}
        </p>
      </section>
    </div>

    <template #footer>
      <div class="chart-edit-modal__footer">
        <p
          v-if="sourceChanged"
          class="chart-edit-modal__notice"
          role="alert"
        >
          {{ editorMessage('editor.chart.editor.sourceChanged') }}
        </p>
        <p
          v-else-if="isSample"
          class="chart-edit-modal__notice"
        >
          {{ editorMessage('editor.chart.editor.sampleNotice') }}
        </p>
        <ActionButtons
          :secondary-action-text="editorMessage('editor.chart.editor.cancel')"
          :primary-action-text="editorMessage('editor.chart.editor.save')"
          :is-primary-action-disabled="!canConfirm"
          @secondary-click="emit('cancel')"
          @primary-click="onConfirm"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRef } from 'vue'
import { ActionButtons, CustomTextarea, Modal } from '@linnya/renderer-ui'
import type { MarkdownChartDiagnostic, MarkdownChartSpec } from '@app/schemas'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { ChartSurface } from '../../chart-reading'
import { useChartEditDraft } from '../orchestration/useChartEditDraft'

const props = withDefaults(defineProps<{
  spec: MarkdownChartSpec
  /** 刚插入的示例图表：保存按钮旁提示“数据是示例”。 */
  isSample?: boolean
  blocked?: boolean
}>(), { isSample: false })

const emit = defineEmits<{
  confirm: [spec: MarkdownChartSpec]
  cancel: []
}>()

const { editorMessage } = useEditorLocalization()
// 模态只拦截手工操作；Agent/Revision 仍可更新原块。保留草稿供复制，但禁止覆盖新版本。
const { sourceText, evaluation, previewSpec, diagnostics, canConfirm, sourceChanged, changed, previewIsStale, setSource, confirm }
  = useChartEditDraft({ initialSpec: props.spec, currentSpec: toRef(props, 'spec'), blocked: toRef(props, 'blocked') })
const sourceHost = ref<HTMLElement | null>(null)

const statusText = computed(() => {
  if (evaluation.value.kind === 'valid') return editorMessage('editor.chart.editor.valid')
  if (evaluation.value.kind === 'invalid') return editorMessage('editor.chart.editor.invalid', { count: diagnostics.value.length })
  return ''
})
const statusClass = computed(() => ({
  'is-valid': evaluation.value.kind === 'valid',
  'is-invalid': evaluation.value.kind === 'invalid',
}))

function describeLocation(item: MarkdownChartDiagnostic): string {
  return item.location ? `${item.location.line}:${item.location.column}` : item.path
}

function onConfirm(): void {
  if (!canConfirm.value) return
  const spec = confirm()
  if (spec) emit('confirm', spec)
}

function onSourceKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    onConfirm()
  }
}

onMounted(async () => {
  await nextTick()
  sourceHost.value?.querySelector('textarea')?.focus()
})
</script>
