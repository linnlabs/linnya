<template>
  <node-view-wrapper
    ref="wrapperRef"
    class="chart-block-node-view"
    :class="{ 'is-selected': selected, 'is-readonly': !editor.isEditable }"
    :data-chart-block-id="blockId"
    :data-chart-revision="revision.badge ?? undefined"
  >
    <div
      v-if="revision.badge"
      class="chart-block-node-view__revision"
      :data-kind="revision.badge"
      role="status"
    >
      <span class="chart-block-node-view__revision-badge">
        {{ revision.badge === 'deleted' ? editorMessage('editor.chart.revision.deletedBadge') : editorMessage('editor.chart.revision.proposedBadge') }}
      </span>
      <BaseButton
        v-if="revision.canToggleBaseline"
        variant="plain"
        size="sm"
        @click.stop="toggleBaseline"
      >
        {{ showingBaseline ? editorMessage('editor.chart.revision.showProposed') : editorMessage('editor.chart.revision.showBaseline') }}
      </BaseButton>
    </div>

    <ChartSurface
      v-if="displaySpec"
      :spec="displaySpec"
      :reading-key="readingKey"
      :active="blockActivation.isUiActive.value"
      :transitions="!revision.pending"
    >
      <template
        v-if="editor.isEditable && revision.editable"
        #actions
      >
        <IconButton
          size="xs"
          :label="editorMessage('editor.chart.action.edit')"
          @click.stop="openEditor(false)"
        >
          <EditIcon />
        </IconButton>
      </template>
    </ChartSurface>
    <p
      v-else-if="revision.showBaselineNote"
      class="chart-block-node-view__note"
    >
      {{ editorMessage('editor.chart.revision.baselineNotChart') }}
    </p>
    <p
      v-else
      class="chart-block-node-view__invalid"
      role="alert"
    >
      {{ editorMessage('editor.chart.status.renderFailed') }}
    </p>

    <ChartEditModal
      v-if="editing && spec"
      :spec="spec"
      :is-sample="editingSample"
      :blocked="!revision.editable"
      @confirm="onConfirm"
      @cancel="closeEditor"
    />
  </node-view-wrapper>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { BaseButton, IconButton } from '@linnya/renderer-ui'
import { EditIcon } from '@linnya/renderer-ui/icons'
import { MarkdownChartSpecSchema, type MarkdownChartSpec } from '@app/schemas'
import { useCurrentBlockActivation } from '../../../ui/composables/useCurrentBlockActivation'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import {
  dispatchNodeViewRenderVirtualizationKeepAlive,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
} from '../../../features/RenderVirtualization'
import { ChartEditModal, useChartEditingStore } from '../../../features/chart-editing'
import { ChartSurface, type ChartReadingKey } from '../../../features/chart-reading'
import { useChartRevisionView } from '../orchestration/useChartRevisionView'

const props = defineProps(nodeViewProps)
const { editorMessage } = useEditorLocalization()
const blockActivation = useCurrentBlockActivation()
const keepAlivePort = inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null)
const editingStore = useChartEditingStore()

const wrapperRef = ref<{ $el?: HTMLElement } | null>(null)
const editing = ref(false)
const editingSample = ref(false)

const blockId = computed<string>(() => {
  const id: unknown = props.node.attrs['id']
  return typeof id === 'string' ? id : ''
})

// 载入的文档由后端保证规格合法；版本错位等意外情况只显示错误提示，不让整篇文档渲染失败。
const spec = computed<MarkdownChartSpec | null>(() => {
  const parsed = MarkdownChartSpecSchema.safeParse(props.node.attrs['spec'])
  return parsed.success ? parsed.data : null
})

function readSessionId(): string {
  return props.editor.storage.chartBlock.sessionId
}

// 修订以 rootBlock 为单位；节点更新（如规格被替换）时重新读取所在块的 id。
const rootBlockId = computed<string | null>(() => {
  void props.node
  const pos = props.getPos()
  if (typeof pos !== 'number') return null
  const id: unknown = props.editor.state.doc.resolve(pos).parent.attrs['id']
  return typeof id === 'string' ? id : null
})
const { revision, baselineSpec, showingBaseline, toggleBaseline } = useChartRevisionView({ editor: props.editor, rootBlockId })

// 展示的规格：Pending 下读者可切换到原图表；否则就是节点里的规格。
const displaySpec = computed<MarkdownChartSpec | null>(() => (revision.value.displaysBaseline ? baselineSpec.value : spec.value))

const readingKey = computed<ChartReadingKey>(() => ({
  editorSessionId: readSessionId(),
  blockId: blockId.value,
  variant: revision.value.readingVariant,
}))

function setKeepAlive(active: boolean): void {
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  dispatchNodeViewRenderVirtualizationKeepAlive({
    target: wrapperRef.value?.$el ?? null,
    editor: props.editor,
    getPos: () => pos,
    reason: 'interaction-open',
    active,
    keepAlivePort,
  })
}

function openEditor(sample: boolean): void {
  if (!props.editor.isEditable || !revision.value.editable || !spec.value) return
  editingSample.value = sample
  editing.value = true
  setKeepAlive(true)
}

function closeEditor(): void {
  editing.value = false
  setKeepAlive(false)
  props.editor.commands.focus()
}

function onConfirm(next: MarkdownChartSpec): void {
  if (!props.editor.isEditable || !revision.value.editable) return
  // 一次确认 = 一个事务 = 一步撤销：属性更新走 Tiptap 的 NodeView 通道。
  props.updateAttributes({ spec: next })
  closeEditor()
}

// 插入命令与块菜单先登记“待打开”请求，NodeView 创建/更新后认领。
watch(
  () => editingStore.pending,
  pending => {
    if (!pending) return
    const request = editingStore.consume({ editorSessionId: readSessionId(), blockId: blockId.value })
    if (request) openEditor(request.isSample === true)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (editing.value) setKeepAlive(false)
})
</script>
