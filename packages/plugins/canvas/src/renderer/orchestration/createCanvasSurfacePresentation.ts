import { canvasBounds, type CanvasCard } from '@plugin/canvas/shared';
import { computed } from 'vue';
import { describeCanvasSelection } from '../features/accessibility';
import { canvasIntegrityNotice } from '../functions/canvasIntegrityNotice';
import { canvasSelectionToolbarStyle } from '../functions/canvasSelectionToolbarStyle';
import { canvasSelectionOutlineCenter } from '../kernel/cardFrame';

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
  const selectionStyle = computed(() => {
    const chosen = new Set(selectedCards.value.map(card => card.id));
    return canvasSelectionToolbarStyle(
      canvasBounds(selectedCards.value),
      camera.value,
      options.host.clientWidth,
      { obstacles: chosen.size ? cards().filter(card => !chosen.has(card.id)) : [] }
    );
  });
  // 改尺寸不画手柄：沿选中描边中线铺一圈不可见的拖动区，屏幕宽度不随缩放变化。
  const resizeFrameStyle = computed(() => {
    const card =
      resizing.state.preview.value ??
      (selectedCards.value.length === 1 ? selectedCards.value[0] : undefined);
    if (!card) return { display: 'none' };
    const { x, y, zoom } = camera.value,
      inset = canvasSelectionOutlineCenter(base.readAppearance().material, zoom);
    return {
      left: `${x + (card.x + inset) * zoom}px`,
      top: `${y + (card.y + inset) * zoom}px`,
      width: `${(card.width - inset * 2) * zoom}px`,
      height: `${(card.height - inset * 2) * zoom}px`,
    };
  });
  // 改尺寸拖动中，选区浮条与连线锚点仍按旧外框定位，会压在预览框里；拖动期间收起。
  const resizingCard = computed(() => resizing.state.preview.value !== null);
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
  // 右键菜单只给出相对画布宿主的屏幕点；菜单移到 body 后由页面换算视口坐标并贴边收进视口。
  const contextPoint = computed(() => {
    const point = context.value?.point;
    return point ? kernel.worldToScreen(point) : null;
  });
  return {
    selectedCards,
    selectionStyle,
    resizeFrameStyle,
    resizingCard,
    integrityNotice,
    editingDraft,
    hoveredCard,
    hasDraft,
    selectionDescription,
    contextPoint,
  };
}
