import { computed, watch, type Ref } from 'vue';
import { JsonValueSchema } from '@app/schemas';
import type { EmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
import type { CanvasCamera, CanvasCard } from '@plugin/canvas/shared';
import { cardEditorStyle, type CanvasCardEditor } from '../features/cardEditing';
import type { createCanvasTextCreation } from '../features/textCreation';
import type { CanvasKernel } from '../kernel';
import { installCanvasCardInk } from '../features/cardRendering/content';
import { readCanvasIsDark } from '../functions/readCanvasAppearance';

/** 单一 DOM 编辑器只跟随当前草稿；切卡替换与光栅资源各有自己的生命周期。 */
export function installCanvasEditorProjection(options: {
  readonly host: HTMLElement; readonly editor: CanvasCardEditor; readonly creation: ReturnType<typeof createCanvasTextCreation>; readonly editable: Pick<EmbeddedMarkdownEditor, 'replaceContent' | 'focus'>;
  readonly kernel: Pick<CanvasKernel, 'setEditingCard'>; readonly camera: Readonly<Ref<CanvasCamera>>;
  readonly cards: () => readonly CanvasCard[]; readonly setDirty: () => void; readonly refresh: () => void;
}) {
  const color = () => options.cards().find(card => card.id === options.editor.state.draft.value?.elementId)?.color ?? 'white';
  const refreshInk = () => installCanvasCardInk(options.host, color(), readCanvasIsDark());
  const stopInk = watch(color, refreshInk, { immediate: true });
  const bodyObserver = new ResizeObserver(() => { const body = options.host.firstElementChild; if (body) { const height = body.getBoundingClientRect().height / options.camera.value.zoom + 34; if (options.creation.state.draft.value) options.creation.measure(height); else options.editor.measure(height); } });
  if (options.host.firstElementChild) bodyObserver.observe(options.host.firstElementChild);
  const stopEditing = watch(() => options.editor.state.draft.value?.elementId, id => options.kernel.setEditingCard(id ?? null));
  const stop = watch(() => options.creation.state.draft.value?.identity ?? options.editor.state.draft.value?.historyGroupId, () => {
    const draft = options.creation.state.draft.value ?? options.editor.state.draft.value;
    if (draft) { options.editable.replaceContent(JsonValueSchema.parse(draft.content)); options.editable.focus(); }
    else { options.setDirty(); options.refresh(); }
  });
  const style = computed(() => {
    if (options.creation.state.draft.value) return cardEditorStyle(options.creation.state.draft.value, options.camera.value);
    const draft = options.editor.state.draft.value, card = options.cards().find(candidate => candidate.id === draft?.elementId);
    return cardEditorStyle(card?.type === 'text' && card.data.heightMode === 'auto' && draft?.measuredHeight ? { ...card, height: draft.measuredHeight } : card ?? draft?.placement, options.camera.value);
  });
  return { style, refreshInk, dispose() { stop(); stopEditing(); stopInk(); bodyObserver.disconnect(); } };
}
