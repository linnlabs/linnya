import type { CanvasCard, CanvasEdge, CanvasEndpoint, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasConnectionKernel, CanvasEndpointGesture } from '../definitions/canvasConnections';
import type { createCanvasConnectionState } from '../store/createCanvasConnectionState';
import { canvasEndpointAt } from '../functions/canvasConnectionAnchors';

export function createCanvasEndpointGesture(session: CanvasDocumentSession, kernel: CanvasConnectionKernel, state: ReturnType<typeof createCanvasConnectionState>, report: (failure: unknown) => void, createText: (point: CanvasPoint, from: CanvasEndpoint) => Promise<void>) {
  let active: CanvasEndpointGesture | null = null, renewal: ReturnType<typeof setInterval> | null = null;
  const world = (event: PointerEvent) => { const bounds = kernel.canvas.getBoundingClientRect(); return kernel.screenToWorld({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }); };
  const release = () => {
    if (!active) return null; const gesture = active; active = null;
    gesture.target.removeEventListener('pointermove', move); gesture.target.removeEventListener('pointerup', up); gesture.target.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape, true);
    if (gesture.target.hasPointerCapture(gesture.pointer)) gesture.target.releasePointerCapture(gesture.pointer);
    if (renewal) clearInterval(renewal); renewal = null; state.setPreview(null); return gesture;
  };
  const unprotect = (gesture: CanvasEndpointGesture) => gesture.edge ? session.protect(gesture.edge.id, [], 'line-endpoint') : Promise.resolve();
  const cancel = () => { const gesture = release(); if (gesture) void unprotect(gesture).catch(report); };
  const move = (event: PointerEvent) => { if (active && event.pointerId === active.pointer) state.setPreview({ from: active.origin, to: world(event) }); };
  const up = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointer) return;
    const gesture = release(); if (!gesture) return;
    if (Math.hypot(event.clientX - gesture.screen.x, event.clientY - gesture.screen.y) < 3) { void unprotect(gesture).catch(report); return; }
    const point = world(event), target = canvasEndpointAt(point, kernel.hitTest(point));
    if (gesture.edge) {
      void session.commit([{ op: 'update', id: gesture.edge.id, baseRevision: gesture.edge.revision, patch: { [gesture.field]: target } }]).catch(report).finally(() => { void unprotect(gesture).catch(report); });
    } else if (target.kind === 'point') void createText(point, gesture.from).catch(report);
    else void session.commit([{ op: 'connect', from: gesture.from, to: target, direction: 'forward', label: '', lineStyle: 'curve', linePattern: 'solid' }]).catch(report);
  };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } };
  return {
    start(event: PointerEvent, from: CanvasEndpoint, origin: CanvasPoint, edge: CanvasEdge | null = null, field: 'from' | 'to' = 'to', card?: CanvasCard) {
      if (event.button !== 0 || edge?.locked || card?.locked || !(event.currentTarget instanceof HTMLElement)) return;
      cancel(); const target = event.currentTarget;
      active = { pointer: event.pointerId, target, edge, field, from, origin, screen: { x: event.clientX, y: event.clientY } }; target.setPointerCapture(event.pointerId);
      target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel); window.addEventListener('keydown', escape, true);
      state.setPreview({ from: origin, to: origin });
      if (edge) { void session.protect(edge.id, [field], 'line-endpoint').catch(report); renewal = setInterval(() => { void session.protect(edge.id, [field], 'line-endpoint').catch(report); }, 2000); }
    }, dispose: cancel,
  };
}
