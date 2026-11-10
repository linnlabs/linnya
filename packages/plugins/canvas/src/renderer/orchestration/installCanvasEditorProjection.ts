import { computed, watch, type Ref } from 'vue';
import { JsonValueSchema } from '@app/schemas';
import type { EmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
import type { CanvasCamera, CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import { cardEditorStyle, type CanvasCardEditor } from '../features/cardEditing';
import type { createCanvasTextCreation } from '../features/textCreation';
import type { CanvasKernel, CanvasSelectionFrame } from '../kernel';
import { installCanvasCardInk } from '../features/cardRendering/content';
import { readCanvasIsDark } from '../functions/readCanvasAppearance';

/** 单一 DOM 编辑器只跟随当前草稿；切卡替换与光栅资源各有自己的生命周期。 */
export function installCanvasEditorProjection(options: {
  readonly host: HTMLElement;
  readonly editor: CanvasCardEditor;
  readonly creation: ReturnType<typeof createCanvasTextCreation>;
  readonly editable: Pick<EmbeddedMarkdownEditor, 'replaceContent' | 'focus'>;
  readonly kernel: Pick<CanvasKernel, 'setEditingCard' | 'setSelectionFrame'>;
  /** 改尺寸拖动中的预览外框；与编辑外框一样交给 kernel，选中描边只有一套绘制。 */
  readonly resizeFrame: () => CanvasSelectionFrame | null;
  readonly camera: Readonly<Ref<CanvasCamera>>;
  readonly detailId: Readonly<Ref<CanvasCardId | null>>;
  readonly cards: () => readonly CanvasCard[];
  readonly setDirty: () => void;
  readonly refresh: () => void;
}) {
  const color = () =>
    options.cards().find(card => card.id === options.editor.state.draft.value?.elementId)?.color ??
    'white';
  const refreshInk = () => installCanvasCardInk(options.host, color(), readCanvasIsDark());
  const stopInk = watch(color, refreshInk, { immediate: true });
  const bodyObserver = new ResizeObserver(() => {
    const body = options.host.firstElementChild;
    if (body) {
      const height = body.getBoundingClientRect().height / options.camera.value.zoom + 34;
      if (options.creation.state.draft.value) options.creation.measure(height);
      else options.editor.measure(height);
    }
  });
  if (options.host.firstElementChild) bodyObserver.observe(options.host.firstElementChild);
  // 正文编辑和只读详情共享唯一活 DOM 槽；旧详情关闭不能把新的正文位图重新显示。
  const stopEditing = watch(
    () => options.editor.state.draft.value?.elementId ?? options.detailId.value,
    id => options.kernel.setEditingCard(id),
    { flush: 'sync' }
  );
  const stop = watch(
    () =>
      options.creation.state.draft.value?.identity ??
      options.editor.state.draft.value?.historyGroupId,
    () => {
      const draft = options.creation.state.draft.value ?? options.editor.state.draft.value;
      if (draft) {
        options.editable.replaceContent(JsonValueSchema.parse(draft.content));
        options.editable.focus();
      } else {
        options.setDirty();
        options.refresh();
      }
    }
  );
  // 编辑器所在卡片的实时外框：新建草稿、自动高度的实测高度，或卡片自身。
  const editingFrame = computed<CanvasSelectionFrame | null>(() => {
    const created = options.creation.state.draft.value;
    if (created) return { id: null, rectangle: created };
    const draft = options.editor.state.draft.value;
    if (!draft) return null;
    const card = options.cards().find(candidate => candidate.id === draft.elementId);
    const rectangle =
      card?.type === 'text' && card.data.heightMode === 'auto' && draft.measuredHeight
        ? { ...card, height: draft.measuredHeight }
        : (card ?? draft.placement);
    return rectangle ? { id: draft.elementId, rectangle } : null;
  });
  const stopFrame = watch(
    () => editingFrame.value ?? options.resizeFrame(),
    frame => options.kernel.setSelectionFrame(frame),
    { immediate: true }
  );
  const style = computed(() =>
    cardEditorStyle(editingFrame.value?.rectangle, options.camera.value)
  );
  return {
    style,
    refreshInk,
    dispose() {
      stop();
      stopFrame();
      options.kernel.setSelectionFrame(null);
      stopEditing();
      stopInk();
      bodyObserver.disconnect();
    },
  };
}
