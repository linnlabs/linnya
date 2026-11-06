import { type CanvasCardId } from '@plugin/canvas/shared';
import { createCanvasConnectionEditing } from '../features/connections';
import { createCanvasElementActions } from '../features/elementEditing';
import { mergeCanvasSelection } from '../features/selection';
import { createCanvasCardOpening } from './createCanvasCardOpening';
import { installCanvasReadonlyProjection } from './installCanvasReadonlyProjection';

import { createCanvasSurfaceCreation } from './createCanvasSurfaceCreation';
import type { CanvasSurfaceSelectionOptions } from './definitions/canvasSurfaceComposition';

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
    opened: ports.cardOpened,
    unavailable: () => state.setRenderNotice('当前无法生成精确预览，已继续使用正文编辑器。'),
  });
  async function trySelect(ids: readonly CanvasCardId[], additive = false) {
    opening.cancel();
    if (!(await finish())) return false;
    if (!(await connections.saveLabel())) return false;
    if (ids.length || !additive) await connections.select(null);
    selection.select(mergeCanvasSelection(selection.ids.value, ids, additive));
    kernel.setSelection(selection.ids.value);
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
  });
  const actions = createCanvasElementActions(session, { read: () => selection.ids.value, select });
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
    trySelect,
    select,
    installReadonly,
    actions,
    createText,
    createTree,
  };
}
