import type { DocumentReferencePresentation } from '@app/schemas';
import type { CanvasCard } from '@plugin/canvas/shared';
import type { CanvasCardMediaPort, CanvasReferenceMetadataChange } from '../definitions/cardMedia';
import { canvasMutationTargets, canvasReferencedDocuments } from '../functions/canvasReferencedDocuments';
import { createCanvasDocumentTitleState } from '../store/createCanvasDocumentTitleState';

/** 当前引用身份与失效世代。旧异步结果既不能写回标题，也不能落成新位图。 */
export function createCanvasReferenceMetadata(port: CanvasCardMediaPort) {
  const titles = createCanvasDocumentTitleState(), values = new Map<string, DocumentReferencePresentation>(), versions = new Map<string, number>();
  const pending = new Map<string, Promise<DocumentReferencePresentation>>(), listeners = new Set<(change: CanvasReferenceMetadataChange) => void>();
  let disposed = false, epoch = 0;
  const changed = (change: CanvasReferenceMetadataChange = { kind: 'resolved' }) => { for (const listener of listeners) listener(change); };
  async function read(id: string): Promise<DocumentReferencePresentation> {
    const cached = values.get(id); if (cached) return cached;
    const running = pending.get(id); if (running) return running;
    if (!versions.has(id)) versions.set(id, ++epoch);
    const generation = versions.get(id);
    const task = port.reference(id).then(result => {
      if (disposed) throw new DOMException('Canvas metadata disposed', 'AbortError');
      if (!versions.has(id)) return result;
      if (generation !== versions.get(id)) return read(id);
      values.set(id, result); titles.install(id, result.status === 'available' || result.status === 'plugin_unavailable' ? result.title : null); changed(); return result;
    }).finally(() => { if (pending.get(id) === task) pending.delete(id); });
    pending.set(id, task); return task;
  }
  const invalidate = (ids: readonly string[]) => {
    let invalidated = false;
    for (const id of ids) {
      if (!versions.has(id)) continue;
      versions.set(id, ++epoch); values.delete(id); pending.delete(id); titles.install(id, null);
      invalidated = true;
      void read(id).catch(failure => { if (!disposed) changed({ kind: 'failed', error: failure instanceof Error ? failure : new Error(String(failure)) }); });
    }
    if (invalidated) changed({ kind: 'invalidated' });
  };
  const stop = port.subscribe(event => invalidate(canvasMutationTargets(event, [...versions.keys()])));
  const stopAvailability = port.subscribeAvailability(nodeTypes => invalidate([...versions.keys()].filter(id => { const presentation = values.get(id); return !presentation || presentation.nodeType !== null && nodeTypes.includes(presentation.nodeType); })));
  return { read, version: (id: string) => versions.get(id) ?? 0, generation: () => epoch, titles: () => titles.titles.value,
    key: (card: CanvasCard) => canvasReferencedDocuments(card).map(id => `${id}:${versions.get(id) ?? 0}`).join('|'),
    async refresh(cards: readonly CanvasCard[]) {
      const ids = [...new Set(cards.flatMap(canvasReferencedDocuments))]; let index = 0;
      const retained = new Set(ids);
      for (const id of versions.keys()) if (!retained.has(id)) { versions.delete(id); epoch++; values.delete(id); pending.delete(id); titles.install(id, null); }
      // 已知引用在启动并发读取前统一取得世代；逐项返回不应让整组兴趣反复变化。
      for (const id of ids) if (!versions.has(id)) versions.set(id, ++epoch);
      await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => { while (index < ids.length && !disposed) { const id = ids[index++]; if (id) await read(id); } }));
    },
    subscribe(listener: (change: CanvasReferenceMetadataChange) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; stop(); stopAvailability(); listeners.clear(); pending.clear(); values.clear(); versions.clear(); },
  };
}
