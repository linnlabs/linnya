import { CANVAS_EDITING_RENEWAL_MS } from '@plugin/canvas/shared';
import type { CanvasElementId, CanvasEditingClaimSchema, CanvasSnapshot } from '@plugin/canvas/shared';
import type { z } from 'zod';
import type { CanvasDocumentPort } from '../definitions/canvasDocumentSession';
import { requireWritableCanvas } from '../functions/requireWritableCanvas';
type Fields = z.infer<typeof CanvasEditingClaimSchema>['fields'];

/** 同一视图的 owner 并集一次投递；续约属于视图，业务手势只负责领取和释放。 */
export function createCanvasEditingClaims(options: {
  readonly port: CanvasDocumentPort;
  readonly viewId: string;
  readonly snapshot: () => CanvasSnapshot | null;
  readonly failed: (error: unknown) => void;
}) {
  const protections = new Map<CanvasElementId, Map<string, Fields>>();
  let generation = 0, writes = Promise.resolve();
  let scheduled: Promise<void> | null = null;
  let renewal: ReturnType<typeof setInterval> | undefined;
  function schedule(): Promise<void> {
    if (scheduled) return scheduled;
    const token = generation;
    const run = writes.then(async () => {
      if (scheduled === run) scheduled = null;
      if (token !== generation) return;
      const document = options.snapshot();
      if (!document) throw new Error('Canvas document is not open');
      const claims = [...protections].map(([elementId, owners]) => ({ elementId, fields: [...new Set([...owners.values()].flat())] }));
      await options.port.editing({ documentId: document.documentId, viewId: options.viewId, claims });
    });
    scheduled = run;
    writes = run.catch(() => undefined);
    return run;
  }
  function renew(): void {
    if (protections.size && !renewal) renewal = setInterval(() => { void schedule().catch(options.failed); }, CANVAS_EDITING_RENEWAL_MS);
    if (!protections.size && renewal) { clearInterval(renewal); renewal = undefined; }
  }
  return {
    async protect(elementId: CanvasElementId, fields: Fields, owner: string) {
      const document = options.snapshot();
      if (!document) throw new Error('Canvas document is not open');
      if (fields.length) requireWritableCanvas(document);
      const owners = protections.get(elementId) ?? new Map<string, Fields>();
      if (fields.length) owners.set(owner, fields); else owners.delete(owner);
      if (owners.size) protections.set(elementId, owners); else protections.delete(elementId);
      renew();
      await schedule();
    },
    reset() {
      generation += 1; scheduled = null; protections.clear();
      clearInterval(renewal); renewal = undefined;
    },
    flush: () => writes,
  };
}
