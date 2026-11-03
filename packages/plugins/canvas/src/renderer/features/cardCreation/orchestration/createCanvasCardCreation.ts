import { CanvasCardIdSchema, type CanvasCardId, type CanvasPoint } from '@plugin/canvas/shared';
import { requireWritableCanvas, type CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasCardCreationPort, CanvasPreparedImage } from '../definitions/cardCreation';
import { createCanvasDocumentPickerState } from '../store/createCanvasDocumentPickerState';
import { readImageFile } from '../functions/readImageFile';
import { buildCanvasImageCards } from '../functions/buildCanvasImageCards';
export function createCanvasCardCreation(session: CanvasDocumentSession, port: CanvasCardCreationPort, position: () => CanvasPoint, select: (ids: readonly CanvasCardId[]) => Promise<void>) {
  const picker = createCanvasDocumentPickerState();
  const controller = new AbortController();
  let generation = 0;
  let pickerPoint: CanvasPoint | null = null;
  const documentId = () => requireWritableCanvas(session.state.snapshot.value).documentId;
  const query = async (keyword: string) => {
    const token = ++generation; picker.start();
    try { const candidates = await port.queryDocuments(keyword); if (!controller.signal.aborted && token === generation) picker.install(candidates); }
    catch (error) { if (token === generation) picker.fail(error instanceof Error ? error.message : String(error)); }
  };
  return { picker, query,
    async showDocuments(point = position()) { documentId(); pickerPoint = point; picker.show(); await query(''); },
    async addDocument(targetId: string, point = pickerPoint ?? position()) {
      const result = await session.commit([{ op: 'addDocument', ref: '$document', width: 320, height: 240, x: point.x, y: point.y, data: { documentId: targetId } }]);
      const id = result.refs.$document; if (id) await select([CanvasCardIdSchema.parse(id)]); picker.close();
    },
    async importFiles(files: readonly File[], point = position()) {
      const sourceId = documentId(), images: CanvasPreparedImage[] = [];
      for (const file of files) {
        const bytesBase64 = await readImageFile(file, controller.signal);
        const image = await port.prepareImage(sourceId, bytesBase64);
        controller.signal.throwIfAborted(); images.push({ assetId: image.assetId, width: image.width, height: image.height });
      }
      if (!images.length) return;
      if (documentId() !== sourceId) throw new DOMException('图片导入的画布已关闭', 'AbortError');
      // 所有图片完成准备后一次建立卡片/归属/撤销记录；第二张失败不会留下半批。
      const result = await session.commit(buildCanvasImageCards(images, point));
      const ids = images.flatMap((_image, index) => { const id = result.refs[`$image${index}`]; return id ? [CanvasCardIdSchema.parse(id)] : []; });
      if (ids.length) await select(ids);
    },
    prepare: async (file: File) => port.prepareImage(documentId(), await readImageFile(file, controller.signal)),
    dispose() { generation += 1; controller.abort(); },
  };
}
