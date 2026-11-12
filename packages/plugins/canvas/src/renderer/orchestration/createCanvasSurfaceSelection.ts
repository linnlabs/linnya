import { type CanvasCardId } from '@plugin/canvas/shared';
import { createCanvasConnectionEditing } from '../features/connections';
import { createCanvasElementActions } from '../features/elementEditing';
import { createCanvasSectionEditing } from '../features/sectionEditing';
import { mergeCanvasSelection } from '../features/selection';
import { createCanvasCardOpening } from './createCanvasCardOpening';
import { installCanvasReadonlyProjection } from './installCanvasReadonlyProjection';

import { createCanvasSurfaceCreation } from './createCanvasSurfaceCreation';
import { canvasSelectionOutlineCenter } from '../kernel/cardFrame';
import type { CanvasSurfaceSelectionOptions } from './definitions/canvasSurfaceComposition';
import { canvasText } from '../features/localization';

/** 卡片切换、打开和连线编辑的协作边界；切换前统一完成当前草稿。 */
export function createCanvasSurfaceSelection({
  options,
  ports,
  base,
  rendering,
  drafts,
  readViewport,
}: CanvasSurfaceSelectionOptions) {
  const { session, layout, editor, selection, readonly, report, resizing, dragging, state, cards } =
    base;
  const { kernel, raster, refreshView } = rendering;
  const { editable, finish } = drafts;
  const opening = createCanvasCardOpening({
    kernel,
    readCard: id => cards().find(card => card.id === id),
    finish,
    cameraChanged: () => {
      state.setCamera(kernel.readCamera());
      refreshView();
    },
    prepare: id => raster.prepareEditing(id),
    openText: (id, signal) => editor.open(id, undefined, signal),
    openMedia: card => ports.openCard?.(card),
    openSection: id => sections.begin(id),
    opened: ports.cardOpened,
    unavailable: () => state.setRenderNotice(canvasText('canvas.render.previewUnavailable')),
  });
  async function trySelect(ids: readonly CanvasCardId[], additive = false) {
    opening.cancel();
    // 先换到新选区再收尾草稿：草稿一结束，编辑中的卡会按“仍被选中”露出浮条与连线点，
    // 等保存回来才清掉，看起来就是先闪一下选中。收尾失败时恢复原选区，草稿仍在。
    const previous = selection.ids.value;
    const apply = (next: readonly CanvasCardId[]) => {
      selection.select(next);
      kernel.setSelection(next);
    };
    apply(mergeCanvasSelection(previous, ids, additive));
    if (!(await finish()) || !(await connections.saveLabel())) {
      apply(previous);
      return false;
    }
    if (ids.length || !additive) await connections.select(null);
    return true;
  }
  const select = async (ids: readonly CanvasCardId[], additive = false) => {
    await trySelect(ids, additive);
  };
  const connections = createCanvasConnectionEditing(session, kernel, {
    finishText: finish,
    createText: async (point, from) => {
      await createText(point, '', from);
    },
    clearCards: () => {
      selection.select([]);
      kernel.setSelection([]);
    },
    report,
    readDisplayVersion: () => state.displayVersion.value,
    readAnchorInset: zoom => canvasSelectionOutlineCenter(base.readAppearance().material, zoom),
  });
  const actions = createCanvasElementActions(session, { read: () => selection.ids.value, select });
  const sections = createCanvasSectionEditing({
    session,
    select,
    readDark: () => base.readAppearance().dark,
  });
  const { createText, createTree } = createCanvasSurfaceCreation({
    options,
    base,
    rendering,
    drafts,
    opening,
    connections,
    readViewport,
  });
  // 构造能力不启动immediate订阅；组合根完成意图分发后再显式安装。
  function installReadonly() {
    return installCanvasReadonlyProjection({
      readonly,
      editable,
      clearPreview: () => kernel.clearDragPreview(),
      cancelResize: resizing.dispose,
      suspendEditor: editor.suspend,
      suspendConnections: connections.suspend,
      cancelDrag: dragging.cancel,
      cancelLayout: async () => {
        await layout?.cancel();
      },
      report,
    });
  }
  return {
    opening,
    connections,
    sections,
    trySelect,
    select,
    installReadonly,
    actions,
    createText,
    createTree,
  };
}
