import { createHash } from 'node:crypto';
import type { JsonValue } from '@app/schemas';
import { splitSlideContent, toViewJson, ViewHeaderSchema, type ViewJsonRecord, type ViewReadRequest, type ViewReadResponse } from '@plugin/slides/shared/presentationViewSnapshot';
import type { CachedView, CapturedView } from '../definitions/viewSnapshotCache';

export function buildViewTransfer(nodeId: string, captured: CapturedView, now: number) {
  const header = ViewHeaderSchema.parse(toViewJson(captured.header));
  const blocks = new Map<string, CachedView['blocks'][number]>();
  function block(value: ViewJsonRecord): string {
    const json = JSON.stringify(toViewJson(value));
    const hash = digest(json);
    if (!blocks.has(hash)) blocks.set(hash, { hash, value, bytes: Buffer.byteLength(json), nodes: countNodes(value) });
    return hash;
  }
  const manifest = (captured.renderModel?.slides ?? []).map(slide => {
    const parts = splitSlideContent(slide);
    const contentHash = block(parts.content);
    const bindingHash = block({ ...parts.binding, contentHash });
    return { slideId: slide.slideId, index: slide.index, contentHash, bindingHash };
  });
  const snapshotId = digest(JSON.stringify(toViewJson({ formatVersion: 2, header, manifest })));
  const bytes = [...blocks.values()].reduce((sum, entry) => sum + entry.bytes, Buffer.byteLength(JSON.stringify(header)));
  const snapshot: CachedView = { nodeId, header, manifest, blocks: [...blocks.values()], bytes, createdAt: now };
  return { snapshotId, snapshot };
}

const BATCH_BYTES = 256 * 1024;
const BATCH_NODES = 150_000;

export function selectViewBatch(snapshotId: string, snapshot: CachedView, request: ViewReadRequest): ViewReadResponse {
    const known = new Set(request.knownHashes);
    const missing = snapshot.blocks.filter(entry => !known.has(entry.hash));
    let offset = request.offset ?? 0;
    if (offset > missing.length) throw new Error('Slides view offset is invalid');
    const response: ViewReadResponse = { formatVersion: 2, snapshotId, nodeId: snapshot.nodeId,
      header: request.snapshotId === undefined ? snapshot.header : null,
      manifest: request.snapshotId === undefined ? snapshot.manifest : [], blocks: [], nextOffset: null };
    let bytes = Buffer.byteLength(JSON.stringify(response));
    let nodes = countNodes(toViewJson(response));
    if (nodes >= BATCH_NODES) throw new Error('Slides navigation exceeds the snapshot node budget');
    while (offset < missing.length) {
      const entry = missing[offset];
      if (nodes + entry.nodes >= BATCH_NODES) {
        if (response.blocks.length === 0) throw new Error('Slides page exceeds the snapshot node budget');
        break;
      }
      if (response.blocks.length && bytes + entry.bytes > BATCH_BYTES) break;
      response.blocks.push({ hash: entry.hash, value: entry.value });
      nodes += entry.nodes + 8;
      bytes += entry.bytes + 100;
      offset++;
    }
    response.nextOffset = offset < missing.length ? offset : null;
    return response;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function countNodes(value: JsonValue): number {
  if (!value || typeof value !== 'object') return 1;
  return 1 + Object.values(value).reduce<number>((sum, item) => sum + countNodes(item), 0);
}
