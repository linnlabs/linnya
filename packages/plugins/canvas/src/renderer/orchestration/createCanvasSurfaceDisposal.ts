import type { CanvasSurfaceDisposalOptions } from './definitions/canvasSurfaceComposition';

/** 显式关闭顺序：先停止交互/订阅，再结束编辑，最后销毁 raster 和 GPU owner。 */
export function createCanvasSurfaceDisposal({
  base,
  rendering,
  drafts,
  selection: commands,
  bindings,
}: CanvasSurfaceDisposalOptions) {
  const { session, layout, editor, dragging, resizing, report } = base;
  const { kernel, raster } = rendering;
  const { editable } = drafts;
  const { opening, connections, tags } = commands;
  const { clipboard, removeSave, removeHistory, stopDisplay, projection, stopDoubleClick } =
    bindings;
  return () => {
    opening.dispose();
    void layout?.dispose().catch(report);
    connections.dispose();
    tags.dispose();
    dragging.dispose();
    resizing.dispose();
    clipboard.dispose();
    removeSave();
    removeHistory();
    bindings.stopReadonly();
    stopDisplay();
    projection.dispose();
    stopDoubleClick();
    editable.destroy();
    editor.dispose();
    void session.close().catch(report);
    raster.dispose();
    kernel.destroy();
  };
}
