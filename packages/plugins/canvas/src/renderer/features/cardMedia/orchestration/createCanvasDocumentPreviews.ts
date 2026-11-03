import type { DocumentPreviewResult } from '@app/schemas';
import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasCardMediaPort } from '../definitions/cardMedia';
type DocumentCard = Extract<CanvasCard, { type: 'document' }>;

/** 只预读可见文档，初开远景也能从owner事实发现应保留的缩略图。 */
export function createCanvasDocumentPreviews(port: CanvasCardMediaPort, version: (id: string) => number, changed: (failure: Error | null) => void) {
  const cache = new Map<string, { readonly result: DocumentPreviewResult; readonly bytes: number }>(), pending = new Map<string, Promise<DocumentPreviewResult>>(), failed = new Set<string>();
  const presentations = new Map<string, { readonly version: number; readonly keep: boolean; readonly revision: string }>();
  const visited = new Set<string>();
  let latest: readonly DocumentCard[] = [], interest = '', bytes = 0, disposed = false;
  const width = (card: DocumentCard) => Math.min(1600, Math.max(120, Math.round(card.width)));
  const key = (card: DocumentCard) => JSON.stringify([port.projectId(), card.data.documentId, version(card.data.documentId), width(card)]);
  function pump(): void {
    if (disposed) return;
    for (const card of latest) {
      if (pending.size >= 4) break;
      const identity = key(card); if (visited.has(identity) || cache.has(identity) || pending.has(identity) || failed.has(identity)) continue;
      visited.add(identity);
      void read(card).catch(failure => { if (!disposed) changed(failure instanceof Error ? failure : new Error(String(failure))); });
    }
  }
  async function read(card: DocumentCard): Promise<DocumentPreviewResult> {
    if (disposed) throw new DOMException('Canvas previews disposed', 'AbortError');
    const identity = key(card), cached = cache.get(identity); if (cached) { cache.delete(identity); cache.set(identity, cached); return cached.result; }
    const running = pending.get(identity); if (running) return running;
    const projectId = port.projectId(); if (!projectId) throw new Error('没有当前项目，无法读取文档卡片');
    const generation = version(card.data.documentId);
    const request = port.preview({ documentId: card.data.documentId, projectId, widthPx: width(card), pixelRatio: 1 }).then(result => {
      if (disposed) throw new DOMException('Canvas previews disposed', 'AbortError');
      if (generation !== version(card.data.documentId) || identity !== key(card)) return read(card);
      presentations.set(card.data.documentId, { version: generation, keep: result.status === 'ready' && result.content?.overview === 'thumbnail', revision: `${result.status}:${result.content?.revisionKey ?? ''}` });
      const size = ((result.content?.image?.dataUri.length ?? 0) + (result.content?.summary.length ?? 0)) * 2;
      if (size <= 32 * 1024 * 1024) {
        while (cache.size && (cache.size >= 128 || bytes + size > 32 * 1024 * 1024)) { const oldest = cache.entries().next().value; if (!oldest) break; cache.delete(oldest[0]); bytes -= oldest[1].bytes; }
        cache.set(identity, { result, bytes: size }); bytes += size;
      }
      changed(null); return result;
    }).catch(failure => { failed.add(identity); throw failure; }).finally(() => { if (pending.get(identity) === request) pending.delete(identity); queueMicrotask(pump); });
    pending.set(identity, request); return request;
  }
  return { read,
    setCards(cards: readonly CanvasCard[]) { const ids = new Set(cards.flatMap(card => card.type === 'document' ? [card.data.documentId] : [])); for (const id of presentations.keys()) if (!ids.has(id)) presentations.delete(id); },
    refreshVisible(cards: readonly CanvasCard[]) { latest = cards.filter((card): card is DocumentCard => card.type === 'document'); const next = JSON.stringify(latest.map(key)); if (next !== interest) { interest = next; visited.clear(); } pump(); },
    refresh() { pump(); },
    key(card: CanvasCard) { return card.type === 'document' ? presentations.get(card.data.documentId)?.revision ?? '' : ''; },
    thumbnails(cards: readonly CanvasCard[]): ReadonlySet<CanvasCardId> { return new Set(cards.flatMap(card => { if (card.type !== 'document') return []; const presentation = presentations.get(card.data.documentId); return presentation?.keep && presentation.version === version(card.data.documentId) ? [card.id] : []; })); },
    retry() { visited.clear(); failed.clear(); cache.clear(); bytes = 0; pump(); },
    dispose() { disposed = true; cache.clear(); pending.clear(); presentations.clear(); visited.clear(); latest = []; bytes = 0; },
  };
}
