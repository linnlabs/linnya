import type { CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';

/** 指针保护从按下持续到共同提交完成；长拖续约不依赖下一次pointermove。 */
export function createCanvasDragProtection(session: CanvasDocumentSession, report: (error: unknown) => void) {
  const ids = new Set<CanvasCardId>();
  const renew = async () => { await Promise.all([...ids].map(id => session.protect(id, ['x', 'y', 'width', 'height'], 'drag'))); };
  return {
    async set(selected: readonly CanvasCardId[], active: boolean) {
      if (active) { selected.forEach(id => ids.add(id)); await renew(); }
      else {
        const released = selected.filter(id => ids.has(id));
        selected.forEach(id => ids.delete(id));
        await Promise.all(released.map(id => session.protect(id, [], 'drag')));
      }
    },
    async cancel() { const selected = [...ids]; ids.clear(); await Promise.all(selected.map(id => session.protect(id, [], 'drag'))); },
    dispose() { const selected = [...ids]; ids.clear(); if (session.state.snapshot.value) void Promise.all(selected.map(id => session.protect(id, [], 'drag'))).catch(report); },
  };
}
