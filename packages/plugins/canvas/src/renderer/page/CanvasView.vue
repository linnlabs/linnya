<template>
  <section
    class="linnya-canvas"
    @keydown="keydown"
  >
    <p
      :id="descriptionId"
      class="canvas-accessible-summary"
      role="status"
      aria-live="polite"
    >
      {{ surface?.selectionDescription.value }}
    </p>
    <div
      ref="stage"
      class="canvas-stage"
    />
    <div
      ref="editorHost"
      class="canvas-editor-overlay markdown-document-content"
      :class="{ 'canvas-editor-provisional': surface?.creation.state.draft.value }"
      :style="editorStyle"
      @compositionstart="surface?.setComposing(true)"
      @compositionend="surface?.setComposing(false)"
      @pointerdown.stop
    />
    <div
      ref="staging"
      class="canvas-raster-staging"
      aria-hidden="true"
    />
    <CanvasReviewMarkers
      v-if="review"
      :review="review"
      :markers="markers"
    />
    <CanvasAgentReviewBar
      v-if="review"
      :review="review"
      :readonly="readonly"
      @locate="surface?.locate($event)"
    />
    <CanvasConnectionControls
      v-if="surface && !draft && !readonly"
      :editing="surface.connections"
      :card="camera.zoom >= 0.3 ? surface.hoveredCard.value ?? (surface.selectedCards.value.length === 1 ? surface.selectedCards.value[0] ?? null : null) : null"
      :camera="camera"
      :run="run"
      @locate="surface.locateEndpoint($event)"
      @focus-canvas="surface?.focus()"
    />
    <div
      v-if="surface"
      class="canvas-command-bar"
      role="toolbar"
      aria-label="画布命令"
      @pointerdown.stop
    >
      <ToolbarGroup>
        <ToolbarButton
          label="撤销 ⌘Z"
          :disabled="readonly"
          @click="run(() => surface?.undo('undo'))"
        >
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton
          label="重做 ⇧⌘Z"
          :disabled="readonly"
          @click="run(() => surface?.undo('redo'))"
        >
          <RedoIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          label="新建文字卡"
          :disabled="readonly"
          @click="run(() => surface?.createText())"
        >
          <TextIcon />
        </ToolbarButton>
        <ToolbarButton
          label="添加文档"
          :disabled="readonly"
          @click="run(() => creation?.showDocuments())"
        >
          <DocumentAddIcon />
        </ToolbarButton>
        <ToolbarButton
          label="添加图片"
          :disabled="readonly"
          @click="imagePicker?.click()"
        >
          <ImageIcon />
        </ToolbarButton>
        <ToolbarButton
          label="搜索画布 ⌘F"
          @click="search?.state.show()"
        >
          搜索
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <CanvasLayoutControls
          v-if="surface.layout && !readonly"
          :layout="surface.layout"
          :on-arrange="surface.arrange"
          :run="run"
        />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          label="显示全部 ⌘1"
          @click="surface.fit()"
        >
          <FullscreenIcon />
        </ToolbarButton>
        <ToolbarButton
          label="缩小 ⌘−"
          @click="surface.zoom(camera.zoom / 1.25)"
        >
          <ZoomOutIcon />
        </ToolbarButton>
        <button
          type="button"
          class="canvas-zoom-value"
          title="缩放到100% ⌘0"
          @click="surface.zoom(1)"
        >
          {{ Math.round(camera.zoom * 100) }}%
        </button>
        <ToolbarButton
          label="放大 ⌘+"
          @click="surface.zoom(camera.zoom * 1.25)"
        >
          <ZoomInIcon />
        </ToolbarButton>
      </ToolbarGroup>
    </div>
    <div
      v-if="surface && selection.length && !draft && !surface.context.value"
      class="canvas-selection-bar"
      :style="surface.selectionStyle.value"
      role="toolbar"
      aria-label="所选卡片"
      @pointerdown.stop
    >
      <ToolbarButton
        label="加入对话 ⌘K"
        @click="addToConversation"
      >
        <LinnyaIcon />
      </ToolbarButton>
      <span class="canvas-selection-count">{{ selection.length }} 张卡</span>
      <ToolbarButton
        label="编辑或打开 ↩"
        @click="run(() => surface?.edit())"
      >
        <EditIcon />
      </ToolbarButton>
      <ToolbarButton
        v-if="selectedImage"
        label="编辑图片（裁剪、图注、替换）"
        :disabled="readonly || selectedImage.locked"
        @click="editImage"
      >
        <ImageIcon />
      </ToolbarButton>
      <ToolbarButton
        label="创建副本 ⌘D"
        :disabled="readonly"
        @click="run(() => surface?.actions.duplicate())"
      >
        <DuplicateIcon />
      </ToolbarButton>
      <ToolbarButton
        v-if="selection.length === 2"
        label="连接两张卡"
        :disabled="readonly"
        @click="run(() => surface?.connect())"
      >
        <LinkIcon />
      </ToolbarButton>
      <CustomSelect
        :model-value="selectedColor"
        :disabled="readonly"
        :options="colors"
        title="卡片颜色"
        width="64px"
        min-width="64px"
        variant="minimal"
        @update:model-value="changeColor"
      />
      <CustomSelect
        :options="moreActions"
        :disabled="readonly"
        placeholder="更多"
        title="更多卡片操作"
        width="58px"
        min-width="58px"
        variant="minimal"
        @update:model-value="elementAction"
      />
    </div>
    <div
      v-if="surface && !readonly && selection.length === 1 && !draft && !surface.selectedCards.value[0]?.locked"
      class="canvas-card-resize-box"
      :style="surface.resizeStyle.value"
    >
      <button
        type="button"
        class="canvas-card-resize-handle"
        aria-label="调整卡片大小，Shift保持比例"
        @pointerdown.stop.prevent="surface.resizeStart($event)"
      />
    </div>
    <div
      v-if="surface?.context.value"
      class="canvas-context-menu"
      :style="surface.contextStyle.value"
      @pointerdown.stop
    >
      <CustomSelect
        :options="contextActions"
        :manual-mode="true"
        :is-open="true"
        min-width="170px"
        max-height="min(600px, 80vh)"
        variant="minimal"
        @update:model-value="elementAction"
        @close="surface.closeContext()"
      />
    </div>
    <CanvasSearchPanel
      v-if="search"
      :search="search"
      @close="surface?.focus()"
    />
    <CanvasWheelSuggestion
      v-if="wheelSuggestion"
      :suggestion="wheelSuggestion"
    />
    <p
      v-if="surface?.layout?.state.busy.value"
      class="canvas-layout-status"
      role="status"
    >
      排布中… <button
        type="button"
        @click="run(() => surface?.layout?.cancel())"
      >
        取消排布（Esc）
      </button>
    </p>
    <p
      v-else-if="surface?.layout?.state.diagnostics.value.length"
      class="canvas-layout-status"
      role="status"
    >
      {{ surface.layout.state.diagnostics.value.map(item => item.message).join('；') }}
    </p>
    <CanvasDocumentPicker
      v-if="creation && !readonly"
      :creation="creation"
    />
    <input
      ref="imagePicker"
      class="canvas-file-input"
      type="file"
      accept="image/*"
      multiple
      aria-label="选择图片"
      @change="imageFiles"
    >
    <ImagePreviewModal
      :is-visible="Boolean(imagePreview)"
      :src="imagePreview?.dataUri"
      alt="画布图片"
      @close="imagePreview = null"
    />
    <CanvasImageEditingControls
      v-if="imageEditing"
      :editor="imageEditing"
    />
    <div
      v-if="surface?.integrityNotice.value || surface?.renderNotice.value"
      class="canvas-read-notice"
      role="status"
    >
      <p v-if="surface.integrityNotice.value">
        {{ surface.integrityNotice.value }}
      </p>
      <p v-if="surface.renderNotice.value">
        {{ surface.renderNotice.value }}
      </p>
    </div>
    <p
      v-if="shownError"
      class="canvas-status canvas-status-error"
      role="alert"
    >
      {{ shownError }}
      <button
        v-if="surface?.hasDraft.value"
        type="button"
        :disabled="saving || Boolean(surface.session.deliveryNotice.value)"
        @click="discardVisible = true"
      >
        使用已保存内容
      </button>
    </p>
    <AlertDialog
      :visible="discardVisible"
      title="使用已保存内容？"
      message="这会放弃当前未保存的草稿，重新显示已保存内容。请先复制需要保留的文字。"
      confirm-text="放弃草稿并继续"
      cancel-text="保留草稿"
      :is-confirmation="true"
      :is-dangerous-action="true"
      :close-is-cancel="true"
      @confirm="confirmDiscard"
      @cancel="discardVisible = false"
      @close="discardVisible = false"
    />
    <div
      v-if="surface?.session.deliveryNotice.value"
      class="canvas-read-notice"
      role="alert"
    >
      {{ surface.session.deliveryNotice.value }}
      <button
        type="button"
        @click="run(() => surface?.session.retryDelivery())"
      >
        重试确认
      </button>
    </div>
    <p
      v-else-if="!surface"
      class="canvas-status"
      role="status"
    >
      正在打开画布…
    </p>
    <p
      v-else-if="saving"
      class="canvas-status"
      role="status"
    >
      正在保存…
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { DocumentImageAsset } from '@app/schemas';
import { ToolbarButton, ToolbarGroup, CustomSelect, ImagePreviewModal, AlertDialog } from '@linnya/renderer-ui';
import { TextIcon, FullscreenIcon, EditIcon, ZoomInIcon, ZoomOutIcon, UndoIcon, RedoIcon, DuplicateIcon, LinkIcon, DocumentAddIcon, ImageIcon, LinnyaIcon } from '@linnya/renderer-ui/icons';
import { getActiveFileSession, markActiveFileDirty, getCurrentWorkspaceProjectId } from '@plugin/renderer/workspaceRuntime';
import { createEmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
import { CanvasColorSchema, type CanvasPoint } from '@plugin/canvas/shared';
import { createCanvasSurface } from '../orchestration/createCanvasSurface';
import { createCanvasPageCommands } from '../orchestration/createCanvasPageCommands';
import { canvasCardMenuActions, canvasContextMenuActions } from '../functions/canvasMenuActions';
import { addCanvasSelectionReference, registerCanvasReferenceFocus } from '../features/conversationSelection';
import { createCanvasSelectionReferencePort } from '../adapters/createCanvasSelectionReferencePort';
import { readCanvasClipboard } from '../adapters/readCanvasSelectionContext';
import { createCanvasDocumentPort } from '../adapters/createCanvasDocumentPort';
import { subscribeCanvasRestored } from '../adapters/subscribeCanvasRestored';
import { createCanvasAgentReviewPort } from '../adapters/createCanvasAgentReviewPort';
import { createCanvasCardMediaPort } from '../adapters/createCanvasCardMediaPort';
import { createCanvasCardCreationPort } from '../adapters/createCanvasCardCreationPort';
import { createCanvasAgentReview, projectCanvasReviewMarkers, CanvasAgentReviewBar, CanvasReviewMarkers } from '../features/agentReview';
import { createCanvasCardContent, type CanvasCardContent } from '../features/cardMedia';
import { createCanvasCardCreation, installCanvasMediaInput, CanvasDocumentPicker } from '../features/cardCreation';
import { createCanvasImageEditing, CanvasImageEditingControls } from '../features/imageEditing';
import { createCanvasSearch, CanvasSearchPanel } from '../features/canvasSearch';
import { CanvasConnectionControls } from '../features/connections';
import { CanvasLayoutControls } from '../features/layoutCommands';
import { CanvasWheelSuggestion, installCanvasWheelSuggestion } from '../features/materialSetting';
import { createCanvasArrangementPort } from '../adapters/createCanvasArrangementPort';

const stage = ref<HTMLElement | null>(null), editorHost = ref<HTMLElement | null>(null), staging = ref<HTMLElement | null>(null), imagePicker = ref<HTMLInputElement | null>(null);
const surface = shallowRef<Awaited<ReturnType<typeof createCanvasSurface>> | null>(null);
const review = shallowRef<ReturnType<typeof createCanvasAgentReview> | null>(null);
const creation = shallowRef<ReturnType<typeof createCanvasCardCreation> | null>(null);
const imageEditing = shallowRef<ReturnType<typeof createCanvasImageEditing> | null>(null);
const search = shallowRef<ReturnType<typeof createCanvasSearch> | null>(null);
const wheelSuggestion = shallowRef<ReturnType<typeof installCanvasWheelSuggestion> | null>(null);
const imagePreview = shallowRef<DocumentImageAsset | null>(null), failure = shallowRef<string | null>(null);
const descriptionId = `canvas-description-${crypto.randomUUID()}`, discardVisible = ref(false);
let destroyed = false, content: CanvasCardContent | null = null, removeMediaInput: (() => void) | null = null, removeReferenceFocus: (() => void) | null = null;
const camera = computed(() => surface.value?.camera.value ?? { x: 0, y: 0, zoom: 1 });
const selection = computed(() => surface.value?.selection.ids.value ?? []);
const readonly = computed(() => surface.value?.readonly.value ?? true);
const draft = computed(() => surface.value?.editingDraft.value);
const saving = computed(() => Boolean(surface.value?.editor.state.saving.value || surface.value?.creation.state.saving.value || surface.value?.session.mutationPending.value));
const editorStyle = computed(() => surface.value?.editorStyle.value ?? { display: 'none' });
const markers = computed(() => review.value && surface.value ? projectCanvasReviewMarkers(review.value.state.groups.value, surface.value.session.state.snapshot.value?.elements ?? [], camera.value, review.value.state.activeGroupId.value) : []);
const shownError = computed(() => failure.value ?? surface.value?.creation.state.error.value ?? surface.value?.editor.state.error.value ?? surface.value?.session.state.error.value ?? surface.value?.error.value);
const selectedColor = computed(() => surface.value?.selectedCards.value[0]?.color ?? 'white');
const selectedImage = computed(() => { const selected = surface.value?.selectedCards.value; return selected?.length === 1 && selected[0]?.type === 'image' ? selected[0] : null; });
const moreActions = canvasCardMenuActions;
const contextActions = computed(() => canvasContextMenuActions({ selectionCount: selection.value.length, edge: Boolean(surface.value?.connections.selected.value), readonly: readonly.value }));
const colors = [{ value: 'white', text: '原色' }, { value: 'red', text: '红' }, { value: 'orange', text: '橙' }, { value: 'yellow', text: '黄' }, { value: 'green', text: '绿' }, { value: 'cyan', text: '青' }, { value: 'purple', text: '紫' }];
const report = (error: unknown) => { failure.value = error instanceof Error ? error.message : String(error); };
const run = async (action: () => Promise<unknown> | undefined) => { failure.value = null; surface.value?.clearFailure(); try { await action(); } catch (error) { report(error); } };
const editImage = () => run(async () => { if (selectedImage.value) await imageEditing.value?.open(selectedImage.value.id); });
const confirmDiscard = () => { discardVisible.value = false; void run(async () => { surface.value?.discardDraft(); }); };
const changeColor = (value: string | number | boolean) => run(() => surface.value?.color(CanvasColorSchema.parse(value)));
let imagePoint: CanvasPoint | undefined;
const menuCommand = createCanvasPageCommands({ readSurface: () => surface.value, addToConversation: () => addToConversation(), showDocuments: async point => { await creation.value?.showDocuments(point); }, pickImages: point => { imagePoint = point; imagePicker.value?.click(); } });
const elementAction = (value: string | number | boolean) => run(() => menuCommand(value));
const imageFiles = (event: Event) => { if (event.target instanceof HTMLInputElement) { const files = Array.from(event.target.files ?? []), point = imagePoint; imagePoint = undefined; event.target.value = ''; void run(() => creation.value?.importFiles(files, point)); } };
const addToConversation = () => run(async () => {
  const current = surface.value, projectId = getCurrentWorkspaceProjectId(), documentId = current?.session.state.snapshot.value?.documentId;
  if (!current || !projectId || !documentId) throw new Error('当前画布没有可访问的项目');
  await addCanvasSelectionReference({ documentId, projectId, elementIds: current.selection.ids.value }, createCanvasSelectionReferencePort());
});
const keydown = (event: KeyboardEvent) => {
  if (!event.isComposing && event.key === 'Escape' && surface.value?.layout?.state.busy.value) { event.preventDefault(); void run(() => surface.value?.layout?.cancel()); return; }
  if (!event.isComposing && (event.ctrlKey || event.metaKey) && ['f', 'k'].includes(event.key.toLowerCase())) {
    event.preventDefault(); if (event.key.toLowerCase() === 'f') search.value?.state.show(); else void addToConversation();
  } else surface.value?.keydown(event);
};
onMounted(async () => {
  const session = getActiveFileSession(), host = stage.value, editorElement = editorHost.value, rasterHost = staging.value;
  if (!session || !host || !editorElement || !rasterHost) { failure.value = '没有可打开的画布文档'; return; }
  try {
    const mediaPort = createCanvasCardMediaPort(), cardContent = createCanvasCardContent(session.documentId, mediaPort); content = cardContent;
    const result = await createCanvasSurface({ host, editorHost: editorElement, stagingHost: rasterHost, documentId: session.documentId, descriptionId }, {
      document: createCanvasDocumentPort(), subscribeRestored: subscribeCanvasRestored, arrangement: createCanvasArrangementPort(), createEditor: createEmbeddedMarkdownEditor, createContent: cardContent.create, readContentKey: cardContent.contentKey, readDocumentTitles: cardContent.documentTitles, refreshReferences: cardContent.refreshReferences, refreshVisibleContent: cardContent.refreshVisible, readThumbnailCards: cardContent.thumbnailCards, retryContent: cardContent.retry, subscribeContent: cardContent.subscribe, resolveImageSource: cardContent.resolveImageSource,
      prepareClipboard: ids => readCanvasClipboard(session.documentId, ids),
      pasteImages: async (files, point) => { if (!creation.value) throw new Error('图片导入尚未就绪'); await creation.value.importFiles(files, point); },
      openCard: async card => { if (card.type === 'image') imagePreview.value = await mediaPort.readImage(session.documentId, card.data.assetId); else await cardContent.open(card); },
      markDirty: dirty => { if (getActiveFileSession()?.documentId === session.documentId) markActiveFileDirty(dirty); },
    });
    if (destroyed) { result.destroy(); cardContent.dispose(); return; }
    removeReferenceFocus = registerCanvasReferenceFocus(session.documentId, async ids => { await result.select(ids); result.fit(true); });
    surface.value = result; review.value = createCanvasAgentReview(result.session, createCanvasAgentReviewPort());
    wheelSuggestion.value = installCanvasWheelSuggestion(host);
    creation.value = createCanvasCardCreation(result.session, createCanvasCardCreationPort(), result.centerPoint, result.select);
    imageEditing.value = createCanvasImageEditing(result.session, { readImage: mediaPort.readImage, prepare: creation.value.prepare });
    search.value = createCanvasSearch(result.session, cardContent.documentTitles, ids => { void run(() => result.focusElements(ids)); });
    removeMediaInput = installCanvasMediaInput({ stage: host, editor: editorElement, creation: creation.value, content: cardContent, captureInsertion: result.captureInsertion, worldPoint: result.worldPoint, canWrite: () => !result.readonly.value, report });
    await review.value.refresh();
  } catch (error) { report(error); }
});
onBeforeUnmount(() => { destroyed = true; wheelSuggestion.value?.dispose(); removeReferenceFocus?.(); removeMediaInput?.(); imageEditing.value?.dispose(); creation.value?.dispose(); review.value?.dispose(); surface.value?.destroy(); content?.dispose(); });
</script>
