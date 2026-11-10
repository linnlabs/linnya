import { createCanvasDocumentPreviewCache } from './createCanvasDocumentPreviewCache';
import type { DocumentPreviewResult } from '@app/schemas';
import type {
  CanvasCardMediaPort,
  CanvasDocumentReferenceVersions,
  CanvasPreviewReadPurpose,
  CanvasDocumentCard,
} from '../definitions/cardMedia';
import { createCanvasPreviewInterest } from './createCanvasPreviewInterest';
import { createCanvasPreviewRequests } from './createCanvasPreviewRequests';
import { canvasText } from '../../localization';

/** 只预读可见文档，初开远景也能从owner事实发现应保留的缩略图。 */
export function createCanvasDocumentPreviews(
  port: CanvasCardMediaPort,
  versions: CanvasDocumentReferenceVersions,
  changed: (failure: Error | null) => void
) {
  const requests = createCanvasPreviewRequests(input => port.preview(input));
  const cache = createCanvasDocumentPreviewCache(id => versions.version(id));
  const pending = new Map<string, Promise<DocumentPreviewResult>>(),
    failed = new Set<string>();
  let disposed = false;
  const width = (card: CanvasDocumentCard) => Math.min(1600, Math.max(120, Math.round(card.width)));
  const key = (card: CanvasDocumentCard) =>
    JSON.stringify([
      port.projectId(),
      card.data.documentId,
      versions.version(card.data.documentId),
      width(card),
    ]);
  async function read(
    card: CanvasDocumentCard,
    purpose: CanvasPreviewReadPurpose
  ): Promise<DocumentPreviewResult> {
    if (disposed) throw new DOMException('Canvas previews disposed', 'AbortError');
    const identity = key(card),
      cached = cache.read(identity);
    // visited只去重预读；真正按需read仍允许缓存被淘汰后重新取得正文。
    interest.visit(identity);
    if (cached) return cached;
    const running = pending.get(identity);
    if (running) return running;
    const projectId = port.projectId();
    if (!projectId) throw new Error(canvasText('canvas.error.projectMissingForCards'));
    const generation = versions.version(card.data.documentId);
    const request = requests
      .read(
        { documentId: card.data.documentId, projectId, widthPx: width(card), pixelRatio: 1 },
        purpose
      )
      .then(result => {
        if (disposed) throw new DOMException('Canvas previews disposed', 'AbortError');
        if (generation !== versions.version(card.data.documentId) || identity !== key(card))
          return read(card, purpose);
        cache.remember({ identity, documentId: card.data.documentId, version: generation, result });
        changed(null);
        return result;
      })
      .catch(failure => {
        failed.add(identity);
        throw failure;
      })
      .finally(() => {
        if (pending.get(identity) === request) pending.delete(identity);
        queueMicrotask(interest.pump);
      });
    pending.set(identity, request);
    return request;
  }
  const interest = createCanvasPreviewInterest({
    versions,
    projectId: () => port.projectId(),
    key,
    has: identity => cache.has(identity) || pending.has(identity) || failed.has(identity),
    running: () => pending.size,
    read: card => read(card, 'prefetch'),
    failed: failure => changed(failure),
  });
  return {
    read: (card: CanvasDocumentCard) => read(card, 'foreground'),
    setCards: cache.setCards,
    refreshVisible: interest.refreshVisible,
    refresh: interest.refresh,
    key: cache.key,
    thumbnails: cache.thumbnails,
    retry() {
      failed.clear();
      cache.clearResults();
      interest.retry();
    },
    dispose() {
      disposed = true;
      requests.dispose();
      cache.dispose();
      pending.clear();
      interest.dispose();
    },
  };
}
