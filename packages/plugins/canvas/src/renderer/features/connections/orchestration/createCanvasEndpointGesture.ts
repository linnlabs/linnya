import { commitCanvasEndpointGesture } from './commitCanvasEndpointGesture';
import type {
  CanvasEndpointGesture,
  CanvasEndpointStart,
  CanvasEndpointGestureOptions,
} from '../definitions/canvasConnections';
import { canvasEndpointAt } from '../functions/canvasConnectionAnchors';

export function createCanvasEndpointGesture(options: CanvasEndpointGestureOptions) {
  const { session, kernel, state, report, createText } = options;
  let active: CanvasEndpointGesture | null = null;
  const world = (event: PointerEvent) => {
    const bounds = kernel.canvas.getBoundingClientRect();
    return kernel.screenToWorld({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const release = () => {
    if (!active) return null;
    const gesture = active;
    active = null;
    gesture.target.removeEventListener('pointermove', move);
    gesture.target.removeEventListener('pointerup', up);
    gesture.target.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', escape, true);
    if (gesture.target.hasPointerCapture(gesture.pointer))
      gesture.target.releasePointerCapture(gesture.pointer);
    state.setPreview(null);
    kernel.setHoveredCard(null);
    return gesture;
  };
  const unprotect = (gesture: CanvasEndpointGesture) =>
    gesture.edge ? session.protect(gesture.edge.id, [], 'line-endpoint') : Promise.resolve();
  const cancel = () => {
    const gesture = release();
    if (gesture) void unprotect(gesture).catch(report);
  };
  const move = (event: PointerEvent) => {
    if (session.state.snapshot.value?.integrity?.readOnly) {
      cancel();
      return;
    }
    if (!active || event.pointerId !== active.pointer) return;
    const point = world(event),
      previous = state.preview.value?.target;
    const nearPrevious =
      previous && canvasEndpointAt(point, [previous], kernel.readCamera().zoom).kind === 'card'
        ? previous
        : null;
    const target = kernel.hitTest(point) ?? nearPrevious;
    state.setPreview({ from: active.origin, to: point, target });
    kernel.setHoveredCard(target?.id ?? null);
  };
  const up = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointer) return;
    if (session.state.snapshot.value?.integrity?.readOnly) {
      cancel();
      return;
    }
    const gesture = release();
    if (!gesture) return;
    if (Math.hypot(event.clientX - gesture.screen.x, event.clientY - gesture.screen.y) < 3) {
      void unprotect(gesture).catch(report);
      return;
    }
    const point = world(event),
      target = canvasEndpointAt(point, kernel.visibleCards(), kernel.readCamera().zoom);
    const completed = commitCanvasEndpointGesture({ session, gesture, target, point, createText });
    if (gesture.edge)
      void completed.catch(report).finally(() => {
        void unprotect(gesture).catch(report);
      });
    else void completed.catch(report);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };
  return {
    start(input: CanvasEndpointStart) {
      const { event, from, origin } = input,
        edge = input.kind === 'reattach' ? input.edge : null,
        field = input.kind === 'reattach' ? input.field : 'to';
      if (
        event.button !== 0 ||
        edge?.locked ||
        session.state.snapshot.value?.integrity?.readOnly ||
        !(event.currentTarget instanceof HTMLElement)
      )
        return;
      cancel();
      const target = event.currentTarget;
      active = {
        pointer: event.pointerId,
        target,
        edge,
        field,
        from,
        origin,
        screen: { x: event.clientX, y: event.clientY },
      };
      target.setPointerCapture(event.pointerId);
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel);
      window.addEventListener('keydown', escape, true);
      state.setPreview({ from: origin, to: origin });
      if (edge) void session.protect(edge.id, [field], 'line-endpoint').catch(report);
    },
    dispose: cancel,
  };
}
