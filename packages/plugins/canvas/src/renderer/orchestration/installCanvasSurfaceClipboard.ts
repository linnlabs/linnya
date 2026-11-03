import type { CanvasCardId, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../kernel';
import type { CanvasSurfacePorts } from '../definitions/canvasSurface';
import { isCanvasReadonly, type CanvasDocumentSession } from '../features/canvasDocument';
import { installCanvasClipboard, selectCanvasSubgraph, canvasPasteOffset, installCanvasPastePosition } from '../features/clipboard';
import { buildDeleteCommands, type createCanvasElementActions } from '../features/elementEditing';

export function installCanvasSurfaceClipboard(options: {
  readonly host: HTMLElement; readonly kernel: CanvasKernel; readonly session: CanvasDocumentSession;
  readonly ports: CanvasSurfacePorts; readonly actions: ReturnType<typeof createCanvasElementActions>;
  readonly canHandle: () => boolean; readonly selection: () => readonly CanvasCardId[]; readonly contextPoint: () => CanvasPoint | undefined;
  readonly select: (ids: readonly CanvasCardId[]) => Promise<void>; readonly createText: (point: CanvasPoint, text: string) => Promise<void>; readonly report: (failure: unknown) => void;
}) {
  const position = installCanvasPastePosition(options.host, options.kernel.screenToWorld.bind(options.kernel)), point = () => options.contextPoint() ?? position.read();
  const clipboard = installCanvasClipboard(options.host, { canHandle: options.canHandle,
    canWrite: () => !isCanvasReadonly(options.session.state.snapshot.value),
    read: () => selectCanvasSubgraph(options.session.state.snapshot.value?.elements ?? [], options.selection()),
    prepare: ids => { if (!options.ports.prepareClipboard) throw new Error('当前表面未配置子图复制'); return options.ports.prepareClipboard(ids); },
    pastePoint: point,
    pasteElements: (elements, destination) => { const delta = canvasPasteOffset(elements, destination); return options.actions.duplicate(elements, delta.x, delta.y); },
    pasteText: (text, destination) => options.createText(destination, text), pasteImages: (files, destination) => { if (!options.ports.pasteImages) throw new Error('当前表面未配置图片粘贴'); return options.ports.pasteImages(files, destination); },
    cut: async elements => { const ids = elements.flatMap(element => element.type === 'edge' ? [] : [element.id]); const commands = buildDeleteCommands(elements, ids); if (commands.length) await options.session.commit(commands); await options.select([]); }, fail: options.report });
  return { ...clipboard, dispose() { clipboard.dispose(); position.dispose(); } };
}
