<template>
  <section
    class="linnya-canvas"
    @keydown="surface?.keydown($event)"
  >
    <div
      ref="stage"
      class="canvas-stage"
    />
    <div
      ref="editorHost"
      class="canvas-editor-overlay markdown-document-content"
      :style="editorStyle"
      @compositionstart="surface?.editor.setComposing(true)"
      @compositionend="surface?.editor.setComposing(false)"
      @pointerdown.stop
    />
    <div
      ref="staging"
      class="canvas-raster-staging"
      aria-hidden="true"
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
          label="新建文字卡"
          @click="run(() => surface?.createText())"
        >
          <TextIcon />
        </ToolbarButton>
        <ToolbarButton
          label="显示全部 ⌘1"
          @click="surface.fit()"
        >
          <FullscreenIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
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
      v-if="surface && selection.length && !draft"
      class="canvas-selection-bar"
      role="toolbar"
      aria-label="所选卡片"
      @pointerdown.stop
    >
      <span>{{ selection.length }} 张卡</span>
      <ToolbarButton
        label="编辑 ↩"
        @click="run(() => surface?.edit())"
      >
        <EditIcon />
      </ToolbarButton>
      <CustomSelect
        :model-value="selectedColor"
        :options="colors"
        title="卡片颜色"
        @update:model-value="changeColor"
      />
    </div>
    <p
      v-if="shownError"
      class="canvas-status canvas-status-error"
      role="alert"
    >
      {{ shownError }}
    </p>
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
import { ToolbarButton, ToolbarGroup, CustomSelect } from '@linnya/renderer-ui';
import { TextIcon, FullscreenIcon, EditIcon, ZoomInIcon, ZoomOutIcon, UndoIcon, RedoIcon, DuplicateIcon, LinkIcon } from '@linnya/renderer-ui/icons';
import { getActiveFileSession, markActiveFileDirty } from '@plugin/renderer/workspaceRuntime';
import { createEmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
import { createCanvasDocumentPort } from '../adapters/createCanvasDocumentPort';
import { createCanvasAgentReviewPort } from '../adapters/createCanvasAgentReviewPort';
import { createCanvasAgentReview, projectCanvasReviewMarkers } from '../features/agentReview';
import CanvasAgentReviewBar from '../features/agentReview/ui/CanvasAgentReviewBar.vue';
import CanvasReviewMarkers from '../features/agentReview/ui/CanvasReviewMarkers.vue';
import { CanvasColorSchema } from '@plugin/canvas/shared';
import { createCanvasSurface } from '../orchestration/createCanvasSurface';

const stage = ref<HTMLElement | null>(null), editorHost = ref<HTMLElement | null>(null), staging = ref<HTMLElement | null>(null);
const surface = shallowRef<Awaited<ReturnType<typeof createCanvasSurface>> | null>(null);
const review = shallowRef<ReturnType<typeof createCanvasAgentReview> | null>(null);
const markers = computed(() => review.value && surface.value ? projectCanvasReviewMarkers(review.value.state.groups.value, surface.value.session.state.snapshot.value?.elements ?? [], camera.value, review.value.state.activeGroupId.value) : []);
const failure = shallowRef<string | null>(null);
let destroyed = false;
const selection = computed(() => surface.value?.selection.ids.value ?? []);
const draft = computed(() => surface.value?.editor.state.draft.value);
const saving = computed(() => surface.value?.editor.state.saving.value ?? false);
const camera = computed(() => surface.value?.camera.value ?? { x: 0, y: 0, zoom: 1 });
const editorStyle = computed(() => surface.value?.editorStyle.value ?? { display: 'none' });
const shownError = computed(() => failure.value ?? surface.value?.editor.state.error.value ?? surface.value?.session.state.error.value ?? surface.value?.error.value);
const selectedColor = computed(() => {
  const id = selection.value[0];
  return surface.value?.session.state.snapshot.value?.elements.find(element => element.id === id)?.color ?? 'white';
});
const moreActions = [{ value: 'lock', text: '锁定 / 解锁' }, { value: 'front', text: '置于顶层' }, { value: 'back', text: '置于底层' }, { value: 'left', text: '左对齐' }, { value: 'top', text: '顶部对齐' }, { value: 'grid', text: '网格排列' }, { value: 'delete', text: '删除' }];
const contextActions = computed(() => selection.value.length ? [{ value: 'edit', text: '编辑' }, { value: 'duplicate', text: '复制卡片' }, ...moreActions] : [{ value: 'new', text: '新建文字卡' }, { value: 'fit', text: '显示全部' }]);
const elementAction = (value: string | number | boolean) => run(async () => {
  const current = surface.value;
  if (!current) return;
  switch (value) {
    case 'new': await current.createText(current.context.value?.point); break;
    case 'fit': current.fit(); break;
    case 'edit': await current.edit(); break;
    case 'duplicate': await current.actions.duplicate(); break;
    case 'lock': await current.actions.lock(); break;
    case 'front': case 'back': await current.actions.layer(value); break;
    case 'left': case 'top': case 'grid': await current.actions.align(value); break;
    case 'delete': await current.remove(); break;
  }
  current.closeContext();
});
const colors = [{ value: 'white', text: '原色' }, { value: 'red', text: '红' }, { value: 'orange', text: '橙' }, { value: 'yellow', text: '黄' }, { value: 'green', text: '绿' }, { value: 'cyan', text: '青' }, { value: 'purple', text: '紫' }];
const run = async (action: () => Promise<unknown> | undefined) => { try { await action(); } catch (error) { failure.value = error instanceof Error ? error.message : String(error); } };
const changeColor = (value: string | number | boolean) => run(() => surface.value?.color(CanvasColorSchema.parse(value)));
onMounted(async () => {
  const session = getActiveFileSession();
  if (!session || !stage.value || !editorHost.value || !staging.value) { failure.value = '没有可打开的画布文档'; return; }
  try {
    const result = await createCanvasSurface({ host: stage.value, editorHost: editorHost.value, stagingHost: staging.value, documentId: session.documentId }, { document: createCanvasDocumentPort(), createEditor: createEmbeddedMarkdownEditor,
      markDirty: dirty => { if (getActiveFileSession()?.documentId === session.documentId) markActiveFileDirty(dirty); } });
    if (destroyed) result.destroy(); else { surface.value = result; review.value = createCanvasAgentReview(result.session, createCanvasAgentReviewPort()); await review.value.refresh(); }
  } catch (error) { failure.value = error instanceof Error ? error.message : String(error); }
});
onBeforeUnmount(() => { destroyed = true; review.value?.dispose(); surface.value?.destroy(); });
</script>
