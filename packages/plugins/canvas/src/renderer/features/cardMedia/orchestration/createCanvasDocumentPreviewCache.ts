import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import {
  CANVAS_DOCUMENT_PREVIEW_CACHE_BYTES,
  CANVAS_DOCUMENT_PREVIEW_CACHE_ENTRIES,
  type CanvasDocumentPreviewCacheEntry,
  type CanvasDocumentPreviewPresentation,
  type CanvasDocumentPreviewCacheWrite,
} from '../definitions/cardMedia';

/** 预览载荷有界缓存与缩略资格共用一份正式结果；重试只清载荷，不猜测新资格。 */
export function createCanvasDocumentPreviewCache(readVersion: (documentId: string) => number) {
  const cache = new Map<string, CanvasDocumentPreviewCacheEntry>();
  const presentations = new Map<string, CanvasDocumentPreviewPresentation>();
  let bytes = 0;
  const clearResults = () => {
    cache.clear();
    bytes = 0;
  };
  return {
    has: (identity: string) => cache.has(identity),
    read(identity: string) {
      const cached = cache.get(identity);
      if (!cached) return undefined;
      cache.delete(identity);
      cache.set(identity, cached);
      return cached.result;
    },
    remember(input: CanvasDocumentPreviewCacheWrite) {
      const { identity, documentId, version, result } = input;
      presentations.set(documentId, {
        version,
        keep: result.status === 'ready' && result.content?.overview === 'thumbnail',
        revision: `${result.status}:${result.content?.revisionKey ?? ''}`,
      });
      // DTO 携带最长 1M 的只读详情；预算包括全文，不能只计封面和摘要。
      const size = JSON.stringify(result).length * 2;
      if (size > CANVAS_DOCUMENT_PREVIEW_CACHE_BYTES) return;
      while (
        cache.size &&
        (cache.size >= CANVAS_DOCUMENT_PREVIEW_CACHE_ENTRIES ||
          bytes + size > CANVAS_DOCUMENT_PREVIEW_CACHE_BYTES)
      ) {
        const oldest = cache.entries().next().value;
        if (!oldest) break;
        cache.delete(oldest[0]);
        bytes -= oldest[1].bytes;
      }
      cache.set(identity, { result, bytes: size });
      bytes += size;
    },
    setCards(cards: readonly CanvasCard[]) {
      const ids = new Set(
        cards.flatMap(card => (card.type === 'document' ? [card.data.documentId] : []))
      );
      for (const id of presentations.keys()) if (!ids.has(id)) presentations.delete(id);
    },
    key(card: CanvasCard) {
      return card.type === 'document'
        ? (presentations.get(card.data.documentId)?.revision ?? '')
        : '';
    },
    thumbnails(cards: readonly CanvasCard[]): ReadonlySet<CanvasCardId> {
      return new Set(
        cards.flatMap(card => {
          if (card.type !== 'document') return [];
          const presentation = presentations.get(card.data.documentId);
          return presentation?.keep && presentation.version === readVersion(card.data.documentId)
            ? [card.id]
            : [];
        })
      );
    },
    clearResults,
    dispose() {
      clearResults();
      presentations.clear();
    },
  };
}
