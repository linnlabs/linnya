import { type CanvasCardId, type CanvasPoint } from '@plugin/canvas/shared';

import type { CanvasSurfaceFacadeOptions } from './definitions/canvasSurfaceComposition';

/** 只暴露页面使用的稳定表面能力，不暴露内部装配依赖。 */
export function createCanvasSurfaceFacade({
  options,
  base,
  rendering,
  drafts,
  selection: commands,
  bindings,
  presentation,
  viewport,
  userCommands,
  operations,
  destroy,
}: CanvasSurfaceFacadeOptions) {
  const { session, editor, readonly, layout, selection, state, report } = base;
  const { kernel, raster, navigate } = rendering;
  const { creation, editable } = drafts;
  const { connections, actions, createText, select, sections, tags } = commands;
  const { projection, clipboard } = bindings;
  const { camera, error, context } = state;
  const { fit, zoom } = viewport;
  return {
    session,
    editor,
    creation,
    readonly,
    renderNotice: state.renderNotice,
    layout,
    connections,
    sections,
    tags,
    selection,
    ...presentation,
    setComposing: (value: boolean) => {
      creation.setComposing(value);
      editor.setComposing(value);
    },
    captureInsertion: editable.captureInsertion,
    worldPoint: (point: CanvasPoint) => kernel.screenToWorld(point),
    centerPoint: () =>
      kernel.screenToWorld({ x: options.host.clientWidth / 2, y: options.host.clientHeight / 2 }),
    camera,
    error,
    context,
    editorStyle: projection.style,
    actions,
    createText,
    select,
    ...userCommands,
    fit,
    zoom,
    report,
    ...operations,
    clipboard,
    focus: viewport.focus,
    focusElements: viewport.focusElements,
    focusRectangle: viewport.focusRectangle,
    readPresentationStats: () => ({ ...kernel.readStats(), status: kernel.readRenderStatus() }),
    viewport: state.viewport,
    readContentReadiness: (ids: readonly CanvasCardId[]) => raster.readReadiness(ids),
    setDetailVisible: state.setDetailVisible,
    /** DOM 叠层（文档详情）挡住画布时，按 kernel 右键同一规则选中卡片并弹出菜单。 */
    openContext: async (id: CanvasCardId, client: CanvasPoint) => {
      if (readonly.value) return;
      const box = kernel.canvas.getBoundingClientRect();
      const point = kernel.screenToWorld({ x: client.x - box.left, y: client.y - box.top });
      if (await viewport.selectContext({ id })) state.setContext({ point, id, edgeId: null });
    },
    navigate,
    clearFailure: state.clearFailure,
    locate: viewport.locate,
    locateEndpoint: (which: 'from' | 'to') => viewport.locateEndpoint(connections.endpoint(which)),
    destroy,
  };
}
