import type { ViewReadRequest, ViewReadResponse } from '@plugin/slides/shared/presentationViewSnapshot';
import { MAX_VIEW_CACHE_BYTES, type CachedView, type CapturedView } from '../definitions/viewSnapshotCache';
import { buildViewTransfer, selectViewBatch } from '../functions/viewTransfer';
const SNAPSHOT_TTL_MS = 30_000;

/** 缓存是短期只读视图，不是第二份文稿；后续批次只读取捕获的同一快照。 */
export class PresentationViewSnapshotRuntime {
  private readonly snapshots = new Map<string, CachedView>();
  private cacheBytes = 0;
  constructor(private readonly capture: (nodeId: string) => Promise<CapturedView>) {}

  async read(request: ViewReadRequest): Promise<ViewReadResponse> {
    this.prune();
    let snapshotId = request.snapshotId;
    if (snapshotId === undefined) {
      const captured = await this.capture(request.nodeId);
      const transfer = buildViewTransfer(request.nodeId, captured, Date.now());
      snapshotId = transfer.snapshotId;
      if (transfer.snapshot.bytes > MAX_VIEW_CACHE_BYTES) throw new Error('Slides view exceeds the 64 MiB snapshot budget');
      const previous = this.snapshots.get(snapshotId);
      if (previous) this.cacheBytes -= previous.bytes;
      this.snapshots.delete(snapshotId);
      this.snapshots.set(snapshotId, transfer.snapshot);
      this.cacheBytes += transfer.snapshot.bytes;
      this.prune();
    }
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.nodeId !== request.nodeId) throw new Error('SLIDES_VIEW_SNAPSHOT_EXPIRED');
    return selectViewBatch(snapshotId, snapshot, request);
  }

  private prune(): void {
    for (const [id, entry] of this.snapshots) {
      if (Date.now() - entry.createdAt > SNAPSHOT_TTL_MS || this.cacheBytes > MAX_VIEW_CACHE_BYTES) {
        this.snapshots.delete(id);
        this.cacheBytes -= entry.bytes;
      }
    }
  }
}
