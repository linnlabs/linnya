import { CanvasCardIdSchema, type CanvasCardId, type CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasCardCreationPort } from '../definitions/cardCreation';
import { createCanvasDocumentPickerState } from '../store/createCanvasDocumentPickerState';
import { readImageFile } from '../functions/readImageFile';
export function createCanvasCardCreation(session: CanvasDocumentSession, port: CanvasCardCreationPort, position: () => CanvasPoint, select: (ids: readonly CanvasCardId[]) => Promise<void>) {
  const picker = createCanvasDocumentPickerState();
  const controller = new AbortController();
  let generation = 0;
  const documentId = () => { const id = session.state.snapshot.value?.documentId; if (!id) throw new Error('画布尚未打开'); return id; };
  const query = async (keyword: string) => {
    const token = ++generation; picker.start();
    try { const candidates = await port.queryDocuments(keyword); if (!controller.signal.aborted && token === generation) picker.install(candidates); }
    catch (error) { if (token === generation) picker.fail(error instanceof Error ? error.message : String(error)); }
  };
  return { picker, query,
    async showDocuments() { picker.show(); await query(''); },
    async addDocument(targetId: string, point = position()) {
      const result = await session.commit([{ op: 'addDocument', ref: '$document', width: 320, height: 240, x: point.x, y: point.y, data: { documentId: targetId } }]);
      const id = result.refs.$document; if (id) await select([CanvasCardIdSchema.parse(id)]); picker.close();
    },
    async importFiles(files: readonly File[], point = position()) {
      const ids: CanvasCardId[] = [];
      for (const [index, file] of files.entries()) {
        const bytesBase64 = await readImageFile(file, controller.signal);
        const result = await port.importImage({ documentId: documentId(), viewId: session.viewId, requestId: crypto.randomUUID(), bytesBase64, caption: '', alt: '', x: point.x + index * 24, y: point.y + index * 24 });
        controller.signal.throwIfAborted(); await session.synchronize(result.sequence);
        for (const outcome of result.results) if (outcome.status === 'applied' && outcome.id) ids.push(CanvasCardIdSchema.parse(outcome.id));
      }
      if (ids.length) await select(ids);
    },
    prepare: async (file: File) => port.prepareImage(documentId(), await readImageFile(file, controller.signal)),
    dispose() { generation += 1; controller.abort(); },
  };
}
