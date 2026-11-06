import { registerCanvasSaveParticipant } from '../features/canvasDocument';
import { createCanvasRestoreDraftParticipants } from './createCanvasRestoreDraftParticipants';
import { installCanvasDisplayProjection } from './installCanvasDisplayProjection';
import { installCanvasEditorProjection } from './installCanvasEditorProjection';
import { installCanvasHistoryRestore } from './installCanvasHistoryRestore';
import { installCanvasSurfaceClipboard } from './installCanvasSurfaceClipboard';
import { installCanvasSurfaceDoubleClick } from './installCanvasSurfaceDoubleClick';

import type { CanvasSurfaceBindingsOptions } from './definitions/canvasSurfaceComposition';

/** 安装 DOM、显示投影及 Host 订阅；返回各自清理句柄，保留关闭顺序。 */
export function installCanvasSurfaceBindings({
  options,
  ports,
  base,
  rendering,
  drafts,
  selection: commands,
}: CanvasSurfaceBindingsOptions) {
  const { session, editor, readonly, preferences, report, state, cards, selection } = base;
  const { camera, context } = state;
  const { kernel, refreshView, readAppearance } = rendering;
  const { editable, creation, setDirty, save } = drafts;
  const { connections, actions, select, createText } = commands;
  // immediate只读投影会同步清掉kernel预览并回发意图，必须在分发能力装配完后安装。
  const stopReadonly = commands.installReadonly();
  const projection = installCanvasEditorProjection({
    host: options.editorHost,
    editor,
    creation,
    editable,
    kernel,
    camera,
    detailId: state.detailId,
    cards,
    setDirty,
    refresh: refreshView,
  });
  const stopDisplay = installCanvasDisplayProjection({
    host: options.host,
    session,
    kernel,
    raster: { refresh: refreshView },
    preferences,
    readAppearance,
    ports,
    report,
    refreshEditorInk: projection.refreshInk,
    viewportChanged: state.setViewport,
  });
  const stopDoubleClick = installCanvasSurfaceDoubleClick({
    host: options.host,
    kernel,
    readonly: () => readonly.value,
    create: async point => {
      await createText(point);
    },
    label: async id => {
      await connections.select(id);
      await connections.beginLabel();
    },
    report,
  });
  const clipboard = installCanvasSurfaceClipboard({
    host: options.host,
    kernel,
    session,
    ports,
    actions,
    canHandle: () => !editor.state.draft.value && !creation.state.draft.value,
    selection: () => selection.ids.value,
    contextPoint: () => context.value?.point,
    select,
    createText: async (point, text) => {
      await createText(point, text);
    },
    report,
  });
  const removeSave = registerCanvasSaveParticipant({ documentId: options.documentId, save });
  const draftParticipants = createCanvasRestoreDraftParticipants({
    editor,
    creation,
    connections,
    report,
  });
  const changedDraft = () => {
    setDirty();
    state.clearFailure();
  };
  const removeHistory = installCanvasHistoryRestore({
    documentId: options.documentId,
    session,
    subscribe: ports.subscribeRestored,
    participants: draftParticipants,
    changed: changedDraft,
    report,
  });
  return {
    stopReadonly,
    projection,
    stopDisplay,
    stopDoubleClick,
    clipboard,
    removeSave,
    draftParticipants,
    changedDraft,
    removeHistory,
  };
}
