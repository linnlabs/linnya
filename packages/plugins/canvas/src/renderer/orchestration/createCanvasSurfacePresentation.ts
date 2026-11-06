import { canvasBounds, type CanvasCard } from '@plugin/canvas/shared';
import { computed } from 'vue';
import { describeCanvasSelection } from '../features/accessibility';
import { cardEditorStyle } from '../features/cardEditing';
import { canvasIntegrityNotice } from '../functions/canvasIntegrityNotice';
import { canvasSelectionToolbarStyle } from '../functions/canvasSelectionToolbarStyle';

import type { CanvasSurfacePresentationOptions } from './definitions/canvasSurfaceComposition';

/** Vue 只读投影：逻辑文档和 kernel 的显示姿态在读取时汇合。 */
export function createCanvasSurfacePresentation({
  options,
  ports,
  base,
  rendering,
  drafts,
  selection: commands,
  bindings,
}: CanvasSurfacePresentationOptions) {
  const { session, editor, selection, state, resizing, cards, selected } = base;
  const { camera, context } = state;
  const { kernel } = rendering;
  const { creation } = drafts;
  const { connections } = commands;
  const { draftParticipants } = bindings;
  // kernel显示坐标不属于Vue状态；版本只触发单卡DOM投影读取，不复制整张场景。
  const displayCard = (card: CanvasCard) => {
    void state.displayVersion.value;
    const position = kernel.readDisplayPosition(card.id);
    return position ? { ...card, ...position } : card;
  };
  const selectedCards = computed(() => {
    const result = selected();
    return result.length === 1 ? result.map(displayCard) : result;
  });
  const selectionStyle = computed(() =>
    canvasSelectionToolbarStyle(
      canvasBounds(selectedCards.value),
      camera.value,
      options.host.clientWidth
    )
  );
  const resizeStyle = computed(() =>
    cardEditorStyle(
      resizing.state.preview.value ??
        (selectedCards.value.length === 1 ? selectedCards.value[0] : undefined),
      camera.value
    )
  );
  const integrityNotice = computed(() => canvasIntegrityNotice(session.state.snapshot.value));
  const editingDraft = computed(() =>
    Boolean(editor.state.draft.value || creation.state.draft.value)
  );
  const hoveredCard = computed(() => {
    const card = cards().find(card => card.id === state.hoveredId.value);
    return card ? displayCard(card) : null;
  });
  const hasDraft = computed(() =>
    draftParticipants.some(participant => participant.readGeneration() !== null)
  );
  const selectionDescription = computed(() =>
    describeCanvasSelection(
      session.state.snapshot.value?.elements ?? [],
      connections.selected.value ? [connections.selected.value.id] : selection.ids.value,
      ports.readDocumentTitles?.() ?? new Map()
    )
  );
  const contextStyle = computed(() => {
    const point = context.value?.point;
    const screen = point ? kernel.worldToScreen(point) : { x: 0, y: 0 };
    return {
      left: `${Math.min(Math.max(8, screen.x), options.host.clientWidth - 180)}px`,
      top: `${Math.min(Math.max(8, screen.y), options.host.clientHeight - 320)}px`,
    };
  });
  return {
    selectedCards,
    selectionStyle,
    resizeStyle,
    integrityNotice,
    editingDraft,
    hoveredCard,
    hasDraft,
    selectionDescription,
    contextStyle,
  };
}
