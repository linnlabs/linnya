import { nextTick } from 'vue';
import type { CanvasCardId, CanvasChangedEvent, CanvasSynchronization } from '@plugin/canvas/shared';
import type { createCanvasSurface } from '../../src/renderer/orchestration/createCanvasSurface';
import type { CanvasRasterReadiness } from '../../src/renderer/orchestration/createCanvasRasterPresentation';
import { createCanvasDocumentPort } from '../../src/renderer/adapters/createCanvasDocumentPort';
import { readCanvasEvaluationCommitScopes, type CanvasEvaluationCommitScope } from './readCanvasEvaluationCommitScopes';
import { createCanvasEvaluationCommitFrameWindows } from './createCanvasEvaluationCommitFrameWindows';
import type { createCanvasEvaluationFrameMetrics } from './createCanvasEvaluationFrameMetrics';

type Surface = Awaited<ReturnType<typeof createCanvasSurface>>;
interface FrameReceipt {
  readonly observedAt: number;
  readonly displayedSequence: number;
  readonly drawCount: number;
  readonly commitToFrameUpperBoundMs?: number;
}
interface BodyReceipt {
  readonly status: 'ready' | 'pending' | 'failed' | 'incomplete' | 'no-visible-body' | 'unattributed' | 'not-required';
  readonly visibleBodyIds: readonly CanvasCardId[];
  readonly readiness?: CanvasRasterReadiness;
  readonly frame?: FrameReceipt;
  readonly supersededCardIds?: readonly CanvasCardId[];
}
interface CommitFrame {
  readonly event: CanvasChangedEvent;
  readonly receivedAt: number;
  readonly status: 'observing' | 'presented' | 'not-visible' | 'not-presented' | 'closed' | 'failed';
  readonly scope?: CanvasEvaluationCommitScope;
  readonly geometry?: FrameReceipt;
  readonly body?: BodyReceipt;
  readonly frames?: ReturnType<ReturnType<typeof createCanvasEvaluationCommitFrameWindows>['finish']>;
  readonly error?: string;
}

/** 变化归属取正式delta；分别记录几何首帧与当前可见正文纹理真正draw后的观测上界。 */
export function createCanvasEvaluationCommitMetrics(surface: Surface, frames: Pick<ReturnType<typeof createCanvasEvaluationFrameMetrics>, 'subscribe'>) {
  const rows = new Map<number, CommitFrame>(), scopes = new Map<number, CanvasEvaluationCommitScope>();
  const windows = createCanvasEvaluationCommitFrameWindows(frames);
  let disposed = false, epoch = 0;
  const append = (row: CommitFrame, token: number) => {
    if (disposed || token !== epoch) return;
    const { scope, geometry, body, error, ...required } = row;
    const terminal = row.status !== 'observing' && (row.status !== 'presented' || row.body?.status !== 'pending');
    rows.set(row.event.sequence, { ...required, ...(scope ? { scope } : {}), ...(geometry ? { geometry } : {}), ...(body ? { body } : {}), ...(error === undefined ? {} : { error }), ...(terminal ? { frames: windows.finish(row.event.sequence) } : {}) });
    while (rows.size > 512) { const first = rows.keys().next(); if (!first.done) rows.delete(first.value); }
  };
  const frameReceipt = (event: CanvasChangedEvent, displayedSequence: number, drawCount: number): FrameReceipt => {
    const observedAt = performance.timeOrigin + performance.now();
    return { observedAt, displayedSequence, drawCount,
      ...(event.committedAt === undefined ? {} : { commitToFrameUpperBoundMs: observedAt - event.committedAt }) };
  };
  async function observe(event: CanvasChangedEvent) {
    if (event.documentId !== surface.session.state.snapshot.value?.documentId || rows.has(event.sequence)) return;
    const token = epoch, receivedAt = performance.timeOrigin + performance.now();
    windows.begin(event.sequence, event.committedAt ?? receivedAt, event.committedAt === undefined ? 'push-received' : 'backend-commit');
    append({ event, receivedAt, status: 'observing' }, token);
    try {
      await surface.session.synchronize(event.sequence); await nextTick();
      const scope = scopes.get(event.sequence), baseline = surface.readPresentationStats().renders, started = performance.now();
      const changedIds = scope?.cards.map(card => card.id) ?? [], revisions = new Map(scope?.cards.map(card => [card.id, card.revision]) ?? []);
      let geometry: FrameReceipt | undefined;
      const poll = () => {
        if (disposed || token !== epoch) return;
        if (document.visibilityState !== 'visible') { append({ event, receivedAt, scope, status: 'not-visible', geometry }, token); return; }
        const stats = surface.readPresentationStats(), sequence = surface.session.state.snapshot.value?.sequence;
        if (sequence === undefined) { append({ event, receivedAt, scope, status: 'closed', geometry }, token); return; }
        if (!geometry && stats.renders > baseline && sequence >= event.sequence) geometry = frameReceipt(event, sequence, stats.renders);
        if (!geometry) {
          if (performance.now() - started >= 5000) { append({ event, receivedAt, scope, status: 'not-presented' }, token); return; }
          requestAnimationFrame(poll); return;
        }
        if (!scope) { append({ event, receivedAt, status: 'presented', geometry, body: { status: 'unattributed', visibleBodyIds: [] } }, token); return; }
        if (!scope.cards.length) { append({ event, receivedAt, scope, status: 'presented', geometry, body: { status: 'not-required', visibleBodyIds: [] } }, token); return; }
        const readiness = surface.readContentReadiness(changedIds);
        const visibleBodyIds = readiness.cards.flatMap(card => card.mode === 'body' ? [card.id] : []);
        const supersededCardIds = readiness.cards.flatMap(card => { const expected = revisions.get(card.id); return expected !== undefined && card.revision !== null && card.revision > expected ? [card.id] : []; });
        const terminal = readiness.complete || visibleBodyIds.length === 0 || readiness.cards.some(card => card.status === 'failed') || performance.now() - started >= 5000;
        const status: BodyReceipt['status'] = readiness.complete ? 'ready' : !visibleBodyIds.length ? 'no-visible-body' : readiness.cards.some(card => card.status === 'failed') ? 'failed' : terminal ? 'incomplete' : 'pending';
        append({ event, receivedAt, scope, status: 'presented', geometry, body: { status, visibleBodyIds, readiness, supersededCardIds, ...(readiness.complete ? { frame: frameReceipt(event, sequence, stats.renders) } : {}) } }, token);
        if (!terminal) requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    } catch (error) { append({ event, receivedAt, status: 'failed', error: error instanceof Error ? error.message : String(error) }, token); }
  }
  const unsubscribe = createCanvasDocumentPort().subscribe(event => { void observe(event); });
  return {
    synchronized(update: CanvasSynchronization) {
      for (const scope of readCanvasEvaluationCommitScopes(update)) scopes.set(scope.sequence, scope);
      while (scopes.size > 512) { const first = scopes.keys().next(); if (!first.done) scopes.delete(first.value); }
    },
    read: () => ({ measurement: 'backend-transaction-return-to-observed-kernel-draw-upper-bound', bodyMeasurement: 'current-visible-body-revision-uploaded-and-drawn', rows: [...rows.values()] }),
    reset() { epoch += 1; rows.clear(); scopes.clear(); windows.clear(); },
    dispose() { disposed = true; epoch += 1; unsubscribe(); windows.dispose(); },
  };
}
