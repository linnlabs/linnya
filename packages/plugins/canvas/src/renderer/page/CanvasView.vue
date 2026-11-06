<template>
  <section class="linnya-canvas" :style="cardFrameStyle" @keydown="keydown">
    <p :id="descriptionId" class="canvas-accessible-summary" role="status" aria-live="polite">
      {{ surface?.selectionDescription.value }}
    </p>
    <div ref="stage" class="canvas-stage" />
    <div
      ref="editorHost"
      class="canvas-editor-overlay"
      :style="editorStyle"
      @compositionstart="surface?.setComposing(true)"
      @compositionend="surface?.setComposing(false)"
      @pointerdown.stop
    />
    <div ref="staging" class="canvas-raster-staging" aria-hidden="true" />
    <CanvasDocumentDetail
      v-if="detailCard && detailPort && detailProjectId"
      :key="`${detailCard.id}:${detailCard.data.documentId}`"
      :card="detailCard"
      :camera="camera"
      :project-id="detailProjectId"
      :title="detailTitle"
      :port="detailPort"
      @close="dismissedDetail = detailCard.id"
    />
    <CanvasReviewMarkers
      v-if="review"
      :review="review"
      :markers="markers"
      :viewport="viewport"
      :readonly="readonly"
      @reveal="revealReview"
    />
    <CanvasConnectionControls
      v-if="surface && !draft && !readonly"
      :editing="surface.connections"
      :card="
        camera.zoom >= 0.3 && !surface.resizingCard.value
          ? (surface.hoveredCard.value ??
            (surface.selectedCards.value.length === 1
              ? (surface.selectedCards.value[0] ?? null)
              : null))
          : null
      "
      :camera="camera"
      :run="run"
      :menu-open="Boolean(contextAnchor)"
      @locate="surface.locateEndpoint($event)"
      @focus-canvas="surface?.focus()"
    />
    <CanvasConnectionLabelPreview
      v-if="surface"
      :editing="surface.connections"
      :camera="camera"
      :viewport="viewport"
      @focus-canvas="surface.focus()"
    />
    <CanvasCommandBar
      v-if="surface"
      :readonly="readonly"
      :saving="saving"
      :unsaved="unsaved"
      @undo="run(() => surface?.undo('undo'))"
      @redo="run(() => surface?.undo('redo'))"
      @create-text="run(() => surface?.createText())"
      @add-document="run(() => creation?.showDocuments())"
      @add-image="imagePicker?.click()"
      @search="search?.state.show()"
    >
      <template #layout>
        <CanvasLayoutControls
          v-if="surface.layout && !readonly"
          :layout="surface.layout"
          :on-arrange="surface.arrange"
          :run="run"
        />
      </template>
    </CanvasCommandBar>
    <CanvasSelectionBar
      v-if="
        surface &&
        selection.length &&
        !draft &&
        !surface.context.value &&
        !surface.resizingCard.value
      "
      :placement="surface.selectionStyle.value"
      :count="selection.length"
      :color="selectedColor"
      :colors="canvasColorMenuOptions"
      :more-actions="moreActions"
      :readonly="readonly"
      :image="Boolean(selectedImage)"
      :image-locked="Boolean(selectedImage?.locked)"
      @converse="addToConversation"
      @edit="run(() => surface?.edit())"
      @edit-image="editImage"
      @duplicate="run(() => surface?.actions.duplicate())"
      @connect="run(() => surface?.connect())"
      @color="changeColor"
      @action="elementAction"
    />
    <div
      v-if="
        surface &&
        !readonly &&
        selection.length === 1 &&
        !draft &&
        !surface.selectedCards.value[0]?.locked
      "
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
    <CanvasPortalMenu
      v-if="contextAnchor"
      :key="`${contextAnchor.left},${contextAnchor.top}`"
      label="画布操作"
      :options="contextActions"
      :anchor="contextAnchor"
      min-width="170px"
      @select="elementAction"
      @close="surface?.closeContext()"
    />
    <CanvasSearchPanel v-if="search" :search="search" @close="surface?.focus()" />
    <CanvasDocumentPicker v-if="creation && !readonly" :creation="creation" />
    <input
      ref="imagePicker"
      class="canvas-file-input"
      type="file"
      accept="image/*"
      multiple
      aria-label="选择图片"
      @change="imageFiles"
    />
    <ImagePreviewModal
      :is-visible="Boolean(imagePreview)"
      :src="imagePreview?.dataUri"
      alt="画布图片"
      @close="imagePreview = null"
    />
    <CanvasImageEditingControls v-if="imageEditing" :editor="imageEditing" />
    <div class="canvas-bottom-dock">
      <CanvasStatusArea :items="statusItems">
        <CanvasWheelSuggestion v-if="wheelSuggestion" :suggestion="wheelSuggestion" />
      </CanvasStatusArea>
      <CanvasAgentReviewBar
        v-if="review"
        :review="review"
        :readonly="readonly"
        :elements="elements"
        :document-titles="documentTitles"
        @locate="surface?.locate($event)"
        @reveal="revealReview"
      />
      <CanvasZoomControls
        v-if="surface"
        :zoom="camera.zoom"
        @zoom="surface.zoom($event)"
        @fit="surface.fit()"
      />
    </div>
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
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { DocumentImageAsset } from '@app/schemas';
import { ImagePreviewModal, AlertDialog } from '@linnya/renderer-ui';
import {
  getActiveFileSession,
  markActiveFileDirty,
  getCurrentWorkspaceProjectId,
} from '@plugin/renderer/workspaceRuntime';
import { createEmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
import type { CanvasCardId, CanvasColor, CanvasPoint } from '@plugin/canvas/shared';
import { mountDocumentPreviewDetail } from '@plugin/renderer/documentPreview';
import { createCanvasSurface } from '../orchestration/createCanvasSurface';
import { createCanvasPageCommands } from '../orchestration/createCanvasPageCommands';
import {
  canvasCardMenuActions,
  canvasContextMenuActions,
  canvasColorMenuOptions,
} from '../functions/canvasMenuActions';
import {
  addCanvasSelectionReference,
  registerCanvasReferenceFocus,
} from '../features/conversationSelection';
import { createCanvasSelectionReferencePort } from '../adapters/createCanvasSelectionReferencePort';
import { readCanvasClipboard } from '../adapters/readCanvasSelectionContext';
import { createCanvasDocumentPort } from '../adapters/createCanvasDocumentPort';
import { subscribeCanvasRestored } from '../adapters/subscribeCanvasRestored';
import { createCanvasAgentReviewPort } from '../adapters/createCanvasAgentReviewPort';
import { createCanvasCardMediaPort } from '../adapters/createCanvasCardMediaPort';
import { createCanvasCardCreationPort } from '../adapters/createCanvasCardCreationPort';
import {
  createCanvasAgentReview,
  projectCanvasReviewMarkers,
  CanvasAgentReviewBar,
  CanvasReviewMarkers,
  type CanvasReviewTarget,
} from '../features/agentReview';
import { createCanvasCardContent, type CanvasCardContent } from '../features/cardMedia';
import {
  createCanvasCardCreation,
  installCanvasMediaInput,
  CanvasDocumentPicker,
} from '../features/cardCreation';
import { createCanvasImageEditing, CanvasImageEditingControls } from '../features/imageEditing';
import { createCanvasSearch, CanvasSearchPanel } from '../features/canvasSearch';
import { CanvasConnectionControls, CanvasConnectionLabelPreview } from '../features/connections';
import { CanvasLayoutControls } from '../features/layoutCommands';
import {
  CanvasCommandBar,
  CanvasPortalMenu,
  CanvasSelectionBar,
  CanvasStatusArea,
  CanvasZoomControls,
  type CanvasMenuAnchor,
} from '../features/canvasChrome';
import { canvasStatusItems } from '../functions/canvasStatusItems';
import {
  CanvasWheelSuggestion,
  installCanvasWheelSuggestion,
  useCanvasPreferencesStore,
} from '../features/materialSetting';
import { CANVAS_CARD_CORNER_RADIUS, CANVAS_CARD_PAPER_INSET } from '../kernel/cardFrame';
import { createCanvasArrangementPort } from '../adapters/createCanvasArrangementPort';
import {
  CanvasDocumentDetail,
  canvasDocumentDetailTarget,
  type CanvasDocumentDetailPort,
} from '../features/documentDetail';

const stage = ref<HTMLElement | null>(null),
  editorHost = ref<HTMLElement | null>(null),
  staging = ref<HTMLElement | null>(null),
  imagePicker = ref<HTMLInputElement | null>(null);
const surface = shallowRef<Awaited<ReturnType<typeof createCanvasSurface>> | null>(null);
const review = shallowRef<ReturnType<typeof createCanvasAgentReview> | null>(null);
const creation = shallowRef<ReturnType<typeof createCanvasCardCreation> | null>(null);
const imageEditing = shallowRef<ReturnType<typeof createCanvasImageEditing> | null>(null);
const search = shallowRef<ReturnType<typeof createCanvasSearch> | null>(null);
const wheelSuggestion = shallowRef<ReturnType<typeof installCanvasWheelSuggestion> | null>(null);
const imagePreview = shallowRef<DocumentImageAsset | null>(null),
  failure = shallowRef<string | null>(null);
const detailPort = shallowRef<CanvasDocumentDetailPort | null>(null),
  detailProjectId = shallowRef<string | null>(null),
  dismissedDetail = shallowRef<CanvasCardId | null>(null);
const descriptionId = `canvas-description-${crypto.randomUUID()}`,
  discardVisible = ref(false);
let destroyed = false,
  content: CanvasCardContent | null = null,
  removeMediaInput: (() => void) | null = null,
  removeReferenceFocus: (() => void) | null = null;
const camera = computed(() => surface.value?.camera.value ?? { x: 0, y: 0, zoom: 1 });
const viewport = computed(() => surface.value?.viewport.value ?? { width: 0, height: 0 });
const elements = computed(() => surface.value?.session.state.snapshot.value?.elements ?? []);
const documentTitles = computed(() =>
  review.value
    ? (content?.documentTitles() ?? new Map<string, string>())
    : new Map<string, string>()
);
const selection = computed(() => surface.value?.selection.ids.value ?? []);
const readonly = computed(() => surface.value?.readonly.value ?? true);
const draft = computed(() => surface.value?.editingDraft.value);
const detailCard = computed(() =>
  canvasDocumentDetailTarget({
    cards: surface.value?.selectedCards.value ?? [],
    zoom: camera.value.zoom,
    editing: Boolean(draft.value),
    projectId: detailProjectId.value,
    dismissed: dismissedDetail.value,
  })
);
const detailTitle = computed(() =>
  detailCard.value
    ? (content?.documentTitles().get(detailCard.value.data.documentId) ?? '文档')
    : '文档'
);
watch(
  () => selection.value.join(','),
  () => {
    dismissedDetail.value = null;
  }
);
const saving = computed(() =>
  Boolean(
    surface.value?.editor.state.saving.value ||
      surface.value?.creation.state.saving.value ||
      surface.value?.session.mutationPending.value
  )
);
// 有草稿而保存出错时，命令条显示“尚有未保存的修改”；具体原因与处理按钮仍在底部状态区。
const unsaved = computed(() => Boolean(surface.value?.hasDraft.value && shownError.value));
const editorStyle = computed(() => surface.value?.editorStyle.value ?? { display: 'none' });
// 编辑器与文档详情叠在卡片上，纸面内缩与圆角取画布卡片同一规则；描边由画布绘制。
const preferences = useCanvasPreferencesStore();
const cardFrameStyle = computed(() => ({
  '--canvas-card-radius': `${CANVAS_CARD_CORNER_RADIUS[preferences.preferences.material]}px`,
  '--canvas-card-inset': `${CANVAS_CARD_PAPER_INSET}px`,
}));
const markers = computed(() =>
  review.value
    ? projectCanvasReviewMarkers({
        groups: review.value.state.groups.value,
        elements: elements.value,
        camera: camera.value,
        activeId: review.value.state.activeGroupId.value,
        documentTitles: documentTitles.value,
      })
    : []
);
const shownError = computed(
  () =>
    failure.value ??
    surface.value?.creation.state.error.value ??
    surface.value?.editor.state.error.value ??
    surface.value?.session.state.error.value ??
    surface.value?.error.value
);
const selectedColor = computed(() => surface.value?.selectedCards.value[0]?.color ?? 'white');
const selectedImage = computed(() => {
  const selected = surface.value?.selectedCards.value;
  return selected?.length === 1 && selected[0]?.type === 'image' ? selected[0] : null;
});
const moreActions = computed(() => {
  const selected = surface.value?.selectedCards.value ?? [];
  return canvasCardMenuActions(selected.length > 0 && selected.every(card => card.locked));
});
// 右键点相对画布宿主；换成视口坐标交给移到 body 的菜单。
const contextAnchor = computed<CanvasMenuAnchor | null>(() => {
  void camera.value;
  const point = surface.value?.contextPoint.value,
    rect = stage.value?.getBoundingClientRect();
  if (!point || !rect) return null;
  const left = rect.left + point.x,
    top = rect.top + point.y;
  return { left, top, right: left, bottom: top, align: 'start' };
});
const contextActions = computed(() =>
  canvasContextMenuActions({
    selectionCount: selection.value.length,
    edge: Boolean(surface.value?.connections.selected.value),
    readonly: readonly.value,
  })
);
const statusItems = computed(() =>
  canvasStatusItems({
    surface: surface.value,
    error: shownError.value ?? null,
    saving: saving.value,
    run,
    discard: () => {
      discardVisible.value = true;
    },
  })
);
const report = (error: unknown) => {
  failure.value = error instanceof Error ? error.message : String(error);
};
const run = async (action: () => Promise<unknown> | undefined) => {
  failure.value = null;
  surface.value?.clearFailure();
  try {
    await action();
  } catch (error) {
    report(error);
  }
};
const markCardViewed = (id: CanvasCardId) => {
  void review.value?.review(id);
};
const editImage = () =>
  run(async () => {
    const card = selectedImage.value;
    if (card) {
      await imageEditing.value?.open(card.id);
      if (imageEditing.value?.state.draft.value?.asset) markCardViewed(card.id);
    }
  });
const revealReview = (target: CanvasReviewTarget) =>
  run(() =>
    surface.value?.focusRectangle(target.bounds, target.kind === 'deleted' ? [] : [target.id])
  );
const confirmDiscard = () => {
  discardVisible.value = false;
  void run(async () => {
    surface.value?.discardDraft();
  });
};
const changeColor = (value: CanvasColor) => run(() => surface.value?.color(value));
let imagePoint: CanvasPoint | undefined;
const menuCommand = createCanvasPageCommands({
  readSurface: () => surface.value,
  addToConversation: () => addToConversation(),
  showDocuments: async point => {
    await creation.value?.showDocuments(point);
  },
  pickImages: point => {
    imagePoint = point;
    imagePicker.value?.click();
  },
});
const elementAction = (value: string | number | boolean) => run(() => menuCommand(value));
const imageFiles = (event: Event) => {
  if (event.target instanceof HTMLInputElement) {
    const files = Array.from(event.target.files ?? []),
      point = imagePoint;
    imagePoint = undefined;
    event.target.value = '';
    void run(() => creation.value?.importFiles(files, point));
  }
};
const addToConversation = () =>
  run(async () => {
    const current = surface.value,
      projectId = getCurrentWorkspaceProjectId(),
      documentId = current?.session.state.snapshot.value?.documentId;
    if (!current || !projectId || !documentId) throw new Error('当前画布没有可访问的项目');
    await addCanvasSelectionReference(
      { documentId, projectId, elementIds: current.selection.ids.value },
      createCanvasSelectionReferencePort()
    );
  });
const keydown = (event: KeyboardEvent) => {
  if (!event.isComposing && event.key === 'Escape' && surface.value?.layout?.state.busy.value) {
    event.preventDefault();
    void run(() => surface.value?.layout?.cancel());
    return;
  }
  if (
    !event.isComposing &&
    (event.ctrlKey || event.metaKey) &&
    ['f', 'k'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    if (event.key.toLowerCase() === 'f') search.value?.state.show();
    else void addToConversation();
  } else surface.value?.keydown(event);
};
onMounted(async () => {
  const session = getActiveFileSession(),
    host = stage.value,
    editorElement = editorHost.value,
    rasterHost = staging.value;
  if (!session || !host || !editorElement || !rasterHost) {
    failure.value = '没有可打开的画布文档';
    return;
  }
  try {
    const mediaPort = createCanvasCardMediaPort(),
      cardContent = createCanvasCardContent(session.documentId, mediaPort);
    content = cardContent;
    const result = await createCanvasSurface(
      {
        host,
        editorHost: editorElement,
        stagingHost: rasterHost,
        documentId: session.documentId,
        descriptionId,
      },
      {
        document: createCanvasDocumentPort(),
        subscribeRestored: subscribeCanvasRestored,
        arrangement: createCanvasArrangementPort(),
        createEditor: createEmbeddedMarkdownEditor,
        createContent: cardContent.create,
        readContentKey: cardContent.contentKey,
        readDocumentTitles: cardContent.documentTitles,
        refreshReferences: cardContent.refreshReferences,
        refreshVisibleContent: cardContent.refreshVisible,
        readThumbnailCards: cardContent.thumbnailCards,
        retryContent: cardContent.retry,
        subscribeContent: cardContent.subscribe,
        resolveImageSource: cardContent.resolveImageSource,
        prepareClipboard: ids => readCanvasClipboard(session.documentId, ids),
        pasteImages: async (files, point) => {
          if (!creation.value) throw new Error('图片导入尚未就绪');
          await creation.value.importFiles(files, point);
        },
        openCard: async card => {
          if (card.type === 'image') {
            imagePreview.value = await mediaPort.readImage(session.documentId, card.data.assetId);
            markCardViewed(card.id);
          } else await cardContent.open(card, markCardViewed);
        },
        cardOpened: markCardViewed,
        markDirty: dirty => {
          if (getActiveFileSession()?.documentId === session.documentId) markActiveFileDirty(dirty);
        },
      }
    );
    if (destroyed) {
      result.destroy();
      cardContent.dispose();
      return;
    }
    removeReferenceFocus = registerCanvasReferenceFocus(session.documentId, async ids => {
      await result.select(ids);
      result.fit(true);
    });
    surface.value = result;
    review.value = createCanvasAgentReview(result.session, createCanvasAgentReviewPort(), {
      beforeMutation: result.prepareMutation,
    });
    detailProjectId.value = mediaPort.projectId();
    detailPort.value = {
      mount: mountDocumentPreviewDetail,
      prepare: result.prepareDetail,
      visible: result.setDetailVisible,
      navigate: result.navigate,
      focus: result.focus,
      open: card => run(() => cardContent.open(card, markCardViewed)),
    };
    wheelSuggestion.value = installCanvasWheelSuggestion(host);
    creation.value = createCanvasCardCreation(
      result.session,
      createCanvasCardCreationPort(),
      result.centerPoint,
      result.select
    );
    imageEditing.value = createCanvasImageEditing(result.session, {
      readImage: mediaPort.readImage,
      prepare: creation.value.prepare,
    });
    search.value = createCanvasSearch(result.session, cardContent.documentTitles, ids => {
      void run(() => result.focusElements(ids));
    });
    removeMediaInput = installCanvasMediaInput({
      stage: host,
      editor: editorElement,
      creation: creation.value,
      content: cardContent,
      captureInsertion: result.captureInsertion,
      worldPoint: result.worldPoint,
      canWrite: () => !result.readonly.value,
      report,
    });
    await review.value.refresh();
  } catch (error) {
    report(error);
  }
});
onBeforeUnmount(() => {
  destroyed = true;
  wheelSuggestion.value?.dispose();
  removeReferenceFocus?.();
  removeMediaInput?.();
  imageEditing.value?.dispose();
  creation.value?.dispose();
  review.value?.dispose();
  surface.value?.destroy();
  content?.dispose();
});
</script>
