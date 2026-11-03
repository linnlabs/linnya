import { nextTick } from 'vue';
import type { CanvasChangedEvent } from '@plugin/canvas/shared';
import type { createCanvasSurface } from '../../src/renderer/orchestration/createCanvasSurface';
import { createCanvasDocumentPort } from '../../src/renderer/adapters/createCanvasDocumentPort';

type Surface = Awaited<ReturnType<typeof createCanvasSurface>>;
interface CommitFrame {
  readonly event: CanvasChangedEvent;
  readonly receivedAt: number;
  readonly status: 'presented' | 'not-visible' | 'not-presented' | 'closed' | 'failed';
  readonly renderedAt?: number;
  readonly displayedSequence?: number;
  readonly drawCount?: number;
  readonly commitToFrameUpperBoundMs?: number;
  readonly error?: string;
}

/** 只采正式推送后的真实kernel draw；RAF本身不被算成内容已绘制。 */
export function createCanvasEvaluationCommitMetrics(surface: Surface) {
  const rows: CommitFrame[] = [];
  let disposed = false, epoch = 0;
  const append = (row: CommitFrame, token: number) => { if (disposed || token !== epoch) return; rows.push(row); if (rows.length > 4096) rows.shift(); };
  async function observe(event: CanvasChangedEvent) {
    if (event.documentId !== surface.session.state.snapshot.value?.documentId) return;
    const token = epoch, receivedAt = performance.timeOrigin + performance.now();
    try {
      await surface.session.synchronize(event.sequence); await nextTick();
      if (document.visibilityState !== 'visible') { append({ event, receivedAt, status: 'not-visible' }, token); return; }
      const baseline = surface.readPresentationStats().renders, started = performance.now();
      // nextTick保证该sequence已进入正式显示投影；之后再等draw计数变化，包含该批或更新批。
      const poll = () => {
        if (disposed || token !== epoch) return;
        if (document.visibilityState !== 'visible') { append({ event, receivedAt, status: 'not-visible' }, token); return; }
        const stats = surface.readPresentationStats(), sequence = surface.session.state.snapshot.value?.sequence;
        if (sequence === undefined) { append({ event, receivedAt, status: 'closed' }, token); return; }
        if (stats.renders > baseline && sequence >= event.sequence) {
          const renderedAt = performance.timeOrigin + performance.now();
          append({ event, receivedAt, status: 'presented', renderedAt, displayedSequence: sequence, drawCount: stats.renders,
            ...(event.committedAt === undefined ? {} : { commitToFrameUpperBoundMs: renderedAt - event.committedAt }) }, token); return;
        }
        if (performance.now() - started >= 5000) { append({ event, receivedAt, status: 'not-presented' }, token); return; }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    } catch (error) { append({ event, receivedAt, status: 'failed', error: error instanceof Error ? error.message : String(error) }, token); }
  }
  const unsubscribe = createCanvasDocumentPort().subscribe(event => { void observe(event); });
  return {
    read: () => ({ measurement: 'backend-transaction-return-to-observed-kernel-draw-upper-bound', rows: [...rows] }),
    reset() { epoch += 1; rows.length = 0; },
    dispose() { disposed = true; epoch += 1; unsubscribe(); },
  };
}
