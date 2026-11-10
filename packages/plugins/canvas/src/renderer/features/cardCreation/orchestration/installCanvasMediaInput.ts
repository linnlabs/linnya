import type { CanvasPoint } from '@plugin/canvas/shared';
import type { EmbeddedMarkdownInsertion } from '@plugin/renderer/embeddedMarkdownEditor';
import type { CanvasCardContent } from '../../cardMedia';
import { canvasText } from '../../localization';
import type { createCanvasCardCreation } from './createCanvasCardCreation';

export function installCanvasMediaInput(options: {
  readonly stage: HTMLElement;
  readonly editor: HTMLElement;
  readonly creation: ReturnType<typeof createCanvasCardCreation>;
  readonly content: CanvasCardContent;
  readonly captureInsertion: () => EmbeddedMarkdownInsertion;
  readonly worldPoint: (point: CanvasPoint) => CanvasPoint;
  readonly report: (error: unknown) => void;
  readonly clearFailure: () => void;
  readonly canWrite: () => boolean;
}) {
  const inline = async (files: readonly File[]) => {
    const insertion = options.captureInsertion();
    const assetIds: string[] = [];
    try {
      for (const file of files) {
        const asset = await options.creation.prepare(file);
        await options.content.stageImage(asset);
        assetIds.push(asset.assetId);
      }
      if (
        !insertion.insert({
          type: 'doc',
          content: assetIds.map(assetId => ({
            type: 'image',
            attrs: { assetId, src: `asset:${assetId}`, alt: '', title: null },
          })),
        })
      )
        throw new Error(canvasText('canvas.input.image.editorClosed'));
    } finally {
      insertion.cancel();
      options.content.releaseStagedImages(assetIds);
    }
  };
  const paste = (event: ClipboardEvent) => {
    // 每次粘贴都经过这里；上次的失败不能留到这次的结果上。
    options.clearFailure();
    const files = Array.from(event.clipboardData?.files ?? []).filter(file =>
      file.type.startsWith('image/')
    );
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (!options.canWrite()) {
      options.report(new Error(canvasText('canvas.input.image.readonly')));
      return;
    }
    void (
      event.currentTarget === options.editor ? inline(files) : options.creation.importFiles(files)
    ).catch(options.report);
  };
  const dragover = (event: DragEvent) => {
    if (
      event.dataTransfer?.types.some(
        type => type === 'application/x-tree-item-id' || type === 'Files'
      )
    )
      event.preventDefault();
  };
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    const id = event.dataTransfer.getData('application/x-tree-item-id');
    const files = Array.from(event.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );
    if (!id && !files.length) return;
    event.preventDefault();
    if (!options.canWrite()) {
      options.report(new Error(canvasText('canvas.input.drop.readonly')));
      return;
    }
    const rect = options.stage.getBoundingClientRect(),
      point = options.worldPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    void (
      id ? options.creation.addDocument(id, point) : options.creation.importFiles(files, point)
    ).catch(options.report);
  };
  options.stage.addEventListener('paste', paste, true);
  options.editor.addEventListener('paste', paste, true);
  options.stage.addEventListener('dragover', dragover);
  options.stage.addEventListener('drop', drop);
  return () => {
    options.stage.removeEventListener('paste', paste, true);
    options.editor.removeEventListener('paste', paste, true);
    options.stage.removeEventListener('dragover', dragover);
    options.stage.removeEventListener('drop', drop);
  };
}
