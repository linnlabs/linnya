import type { CanvasElementId, CanvasEditingRequestSchema, CanvasSnapshot } from '@plugin/canvas/shared';
import type { z } from 'zod';
import type { CanvasDocumentPort } from '../definitions/canvasDocumentSession';
import { requireWritableCanvas } from '../functions/requireWritableCanvas';
type Fields = z.infer<typeof CanvasEditingRequestSchema>['fields'];

/** owner并集和RPC顺序归当前视图；释放不能被迟到续约反向覆盖。 */
export function createCanvasEditingClaims(options: { readonly port: CanvasDocumentPort; readonly viewId: string; readonly snapshot: () => CanvasSnapshot | null }) {
  const protections = new Map<CanvasElementId, Map<string, Fields>>();
  let generation = 0, writes = Promise.resolve();
  return {
    async protect(elementId: CanvasElementId, fields: Fields, owner: string) {
      const token = generation, document = options.snapshot();
      if (!document) throw new Error('Canvas document is not open');
      if (fields.length) requireWritableCanvas(document);
      const owners = protections.get(elementId) ?? new Map<string, Fields>();
      if (fields.length) owners.set(owner, fields); else owners.delete(owner);
      if (owners.size) protections.set(elementId, owners); else protections.delete(elementId);
      const run = writes.then(async () => {
        if (token !== generation) return;
        const current = protections.get(elementId);
        await options.port.editing({ documentId: document.documentId, viewId: options.viewId, elementId, fields: [...new Set([...(current?.values() ?? [])].flat())] });
      });
      writes = run.catch(() => undefined); await run;
    },
    reset() { generation += 1; protections.clear(); },
    flush: () => writes,
  };
}
