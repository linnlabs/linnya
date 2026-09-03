<template>
  <div
    v-if="historyState.isInSideBySideMode"
    class="block-history-side-by-side-header"
    contenteditable="false"
  >
    <div class="header-main-row">
      <div class="header-left">
        <span class="header-label">
          {{ historyState.currentVersionLabel }}
        </span>
      </div>
      <div class="header-right">
        <span class="header-label">
          {{ historyState.selectedVersionLabel }}
        </span>
        <CustomSelect
          v-if="historyState.selectedVersion"
          :options="moreMenuOptions"
          :on-select="handleMoreMenuSelect"
          variant="minimal"
          :manual-mode="false"
          :placeholder="''"
          :title="editorMessage('editor.common.moreActions')"
          :class-names="{
            trigger: 'block-history-more-trigger',
            selectedValue: 'block-history-more-value',
            options: 'block-history-more-options',
          }"
          class="header-more-menu"
        >
          <template #arrow-icon>
            <MoreIcon direction="horizontal" class="more-icon" />
          </template>
        </CustomSelect>
      </div>
    </div>
  </div>

  <HistorySideBySide
    v-if="historyState.isInSideBySideMode"
    class="root-block-history-panel"
    :block-id="props.blockId"
    :current-content="currentContentForPanel"
    :document-node-id="currentDocumentNodeId"
    @exit="handleExitHistoryMode"
    @restore="handleHistoryRestore"
  />

  <HistoryOverlay
    v-if="historyState.isInOverlayMode"
    :block-id="props.blockId"
    :document-node-id="currentDocumentNodeId"
    @close="handleExitHistoryMode"
    @restore="handleHistoryRestore"
  />

  <HistoryTimeline
    v-if="historyState.isInHistoryMode"
    :block-id="props.blockId"
    :document-node-id="currentDocumentNodeId"
    @exit="handleExitHistoryMode"
    @version-select="handleVersionSelect"
    @restore="handleHistoryRestore"
  />

  <AlertDialog
    v-if="showUnsavedVersionDialog"
    :visible="showUnsavedVersionDialog"
    is-confirmation
    :close-is-cancel="false"
    width="520px"
    :title="editorMessage('editor.blockHistory.applyDialog.title')"
    :message="editorMessage('editor.blockHistory.applyDialog.message')"
    :confirm-text="editorMessage('editor.blockHistory.applyDialog.confirm')"
    :cancel-text="editorMessage('editor.blockHistory.applyDialog.cancel')"
    @confirm="confirmRestoreWithSnapshot"
    @cancel="confirmRestoreDiscardChanges"
    @close="cancelRestoreDialog"
  />

  <AlertDialog
    v-if="showDeleteVersionDialog"
    :visible="showDeleteVersionDialog"
    is-confirmation
    :close-is-cancel="true"
    width="420px"
    :title="editorMessage('editor.blockHistory.deleteDialog.title')"
    :message="historyState.deleteVersionDialogMessage"
    :confirm-text="editorMessage('editor.blockHistory.deleteDialog.confirm')"
    :cancel-text="editorMessage('editor.blockHistory.deleteDialog.cancel')"
    @confirm="confirmDeleteVersion"
    @cancel="cancelDeleteVersion"
    @close="cancelDeleteVersion"
  />
</template>

<script setup lang="ts">
/**
 * Host 版块历史面板。
 *
 * 中文说明：
 * - Host 只负责把历史头部、右侧对比面板与时间轴挂回当前 rootBlock 的 DOM 流；
 * - 历史版本选择、恢复、删除仍通过 BlockHistory 的 store / functions / orchestration 完成；
 * - 组件只在 history-mode 的 active block 上出现，避免大文档为所有块常驻历史 UI。
 */

import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { CustomSelect } from '@linnya/renderer-ui';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import {
  findSelectedBlockHistoryVersion,
  readCurrentBlockHistoryVersionLabel,
  readDeleteBlockHistoryVersionDialogMessage,
  readSelectedBlockHistoryVersionLabel,
  restoreBlockHistoryVersionForRootBlock,
  shouldPromptBeforeBlockHistoryRestore,
  useBlockHistoryStore,
  type RestoreBlockHistoryVersionMode,
} from '../../features/BlockHistory'
import { useRenderVirtualizationKeepAliveLease } from '../../features/RenderVirtualization/state/useRenderVirtualizationKeepAliveLease'
import { useFileStore } from '../../../../shared/stores/file'
import { useEditorLocalization } from '../useEditorLocalization'

const HistorySideBySide = defineAsyncComponent(
  () => import('../../features/BlockHistory/ui/HistorySideBySide.vue')
)
const HistoryOverlay = defineAsyncComponent(
  () => import('../../features/BlockHistory/ui/HistoryOverlay.vue')
)
const HistoryTimeline = defineAsyncComponent(
  () => import('../../features/BlockHistory/ui/HistoryTimeline.vue')
)
const AlertDialog = defineAsyncComponent(
  () => import('@linnya/renderer-ui').then(({ AlertDialog: component }) => component)
)

const props = defineProps<{
  editor: Editor
  blockId: string
  rootBlockElement: HTMLElement
  getRootBlockPos: () => number | null
}>()

const blockHistoryStore = useBlockHistoryStore()
const fileStore = useFileStore()
const { currentLocale, editorMessage } = useEditorLocalization()
const editorStateVersion = ref(0)
const pendingRestoreVersionId = ref<string | null>(null)
const showUnsavedVersionDialog = ref(false)
const pendingDeleteVersionId = ref<string | null>(null)
const showDeleteVersionDialog = ref(false)

const currentDocumentNodeId = computed(() => fileStore.currentFilePath || '')
const currentBlockId = computed(() => props.blockId)
const historyUiState = computed(() => blockHistoryStore.getUiState(props.blockId))
const versions = computed(() => blockHistoryStore.getVersions(props.blockId))

function readCurrentRootBlockNode(): ProseMirrorNode | null {
  const pos = props.getRootBlockPos()
  if (pos === null) return null

  const node = props.editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'rootBlock' || node.attrs.id !== props.blockId) return null
  return node
}

const currentRootBlockNode = computed(() => {
  void editorStateVersion.value
  return readCurrentRootBlockNode()
})

const currentContentJson = computed<string | null>(() => {
  const node = currentRootBlockNode.value
  if (!node) return null
  try {
    return JSON.stringify(node.toJSON())
  } catch (error) {
    console.error('[BlockChromeHostHistoryPanel] 序列化当前块内容失败:', error)
    return null
  }
})

const currentContentForPanel = computed(() => currentContentJson.value ?? '{}')

const historyState = computed(() => {
  const selectedVersion = findSelectedBlockHistoryVersion(
    versions.value,
    historyUiState.value.selectedVersionId
  )

  return {
    isInHistoryMode: blockHistoryStore.isInHistoryMode(props.blockId),
    isInSideBySideMode: historyUiState.value.mode === 'side-by-side',
    isInOverlayMode: historyUiState.value.mode === 'overlay',
    selectedVersion,
    currentVersionLabel: readCurrentBlockHistoryVersionLabel(
      currentContentJson.value,
      versions.value,
      editorMessage,
    ),
    selectedVersionLabel: readSelectedBlockHistoryVersionLabel(
      selectedVersion,
      editorMessage,
      currentLocale.value,
    ),
    deleteVersionDialogMessage: readDeleteBlockHistoryVersionDialogMessage(selectedVersion, editorMessage),
  }
})

const moreMenuOptions = computed<CustomSelectOption<string>[]>(() => {
  const selectedVersion = historyState.value.selectedVersion
  if (!selectedVersion) return []
  const label = editorMessage('editor.blockHistory.more.deleteVersion', {
    version: selectedVersion.version_number,
  })
  return [{ label, text: label, value: 'delete', variant: 'danger' }]
})

const handleEditorUpdate = (): void => {
  editorStateVersion.value += 1
}

props.editor.on('update', handleEditorUpdate)

useRenderVirtualizationKeepAliveLease({
  target: () => props.rootBlockElement,
  fallbackTarget: () => props.editor.view.dom,
  blockId: currentBlockId,
  reason: 'history-mode',
  active: computed(() => historyState.value.isInHistoryMode),
})

watch(
  () => historyState.value.isInHistoryMode,
  (isInHistoryMode) => {
    props.rootBlockElement.classList.toggle('history-mode', isInHistoryMode)
  },
  { immediate: true }
)

watch(
  () => historyState.value.isInSideBySideMode,
  (isInSideBySideMode) => {
    props.rootBlockElement.classList.toggle('history-side-by-side-mode', isInSideBySideMode)
  },
  { immediate: true }
)

function handleExitHistoryMode(): void {
  blockHistoryStore.exitHistoryMode(props.blockId)
}

function handleVersionSelect(_versionId: string): void {
  // 中文说明：版本选择已经由 HistoryTimeline 写入 store；Host 不需要重复处理。
}

async function restorePendingVersion(mode: RestoreBlockHistoryVersionMode): Promise<void> {
  const result = await restoreBlockHistoryVersionForRootBlock({
    editor: props.editor,
    documentNodeId: currentDocumentNodeId.value,
    blockId: props.blockId,
    versionId: pendingRestoreVersionId.value,
    mode,
    currentContentJson: currentContentJson.value,
    getRootBlockPos: props.getRootBlockPos,
  })

  if (!result.ok) {
    console.error('[BlockChromeHostHistoryPanel] 恢复历史版本失败:', result)
  }

  pendingRestoreVersionId.value = null
  showUnsavedVersionDialog.value = false
}

function handleHistoryRestore(versionId: string): void {
  if (shouldPromptBeforeBlockHistoryRestore({
    currentContentJson: currentContentJson.value,
    versions: versions.value,
  })) {
    pendingRestoreVersionId.value = versionId
    showUnsavedVersionDialog.value = true
    return
  }

  pendingRestoreVersionId.value = versionId
  void restorePendingVersion('discard-current')
}

function confirmRestoreWithSnapshot(): void {
  void restorePendingVersion('create-current-snapshot')
}

function confirmRestoreDiscardChanges(): void {
  void restorePendingVersion('discard-current')
}

function cancelRestoreDialog(): void {
  pendingRestoreVersionId.value = null
  showUnsavedVersionDialog.value = false
}

function handleMoreMenuSelect(value: string | number | null): void {
  if (value !== 'delete') return

  const selectedVersion = historyState.value.selectedVersion
  if (!selectedVersion) return
  pendingDeleteVersionId.value = selectedVersion.id
  showDeleteVersionDialog.value = true
}

async function confirmDeleteVersion(): Promise<void> {
  const versionId = pendingDeleteVersionId.value
  if (!versionId) {
    showDeleteVersionDialog.value = false
    return
  }

  try {
    await blockHistoryStore.deleteVersion(versionId)
  } catch (error) {
    console.error('[BlockChromeHostHistoryPanel] 删除历史版本失败:', error)
  } finally {
    pendingDeleteVersionId.value = null
    showDeleteVersionDialog.value = false
  }
}

function cancelDeleteVersion(): void {
  pendingDeleteVersionId.value = null
  showDeleteVersionDialog.value = false
}

onBeforeUnmount(() => {
  props.editor.off('update', handleEditorUpdate)
  props.rootBlockElement.classList.remove('history-mode', 'history-side-by-side-mode')
})
</script>
