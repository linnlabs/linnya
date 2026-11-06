import type { CanvasCard } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasResizeDisplay, CanvasResizeGesture } from '../definitions/cardResizing';
import { createCanvasResizeState } from '../store/createCanvasResizeState';
import { resolveCanvasResize } from '../functions/resolveCanvasResize';

export function createCanvasCardResize(
  session: CanvasDocumentSession,
  report: (error: unknown) => void
) {
  const state = createCanvasResizeState();
  let gesture: CanvasResizeGesture | null = null;
  const release = (active: CanvasResizeGesture) => {
    active.target.removeEventListener('pointermove', move);
    active.target.removeEventListener('pointerup', up);
    active.target.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape, true);
    window.removeEventListener('blur', cancel);
    if (active.target.hasPointerCapture(active.pointer))
      active.target.releasePointerCapture(active.pointer);
    gesture = null;
    state.set(null);
  };
  const cancel = () => {
    if (gesture) {
      const active = gesture;
      release(active);
      active.display.clear();
      void session.protect(active.card.id, [], 'resize').catch(report);
    }
  };
  const move = (event: PointerEvent) => {
    if (gesture?.pointer !== event.pointerId) return;
    const size = resolveCanvasResize(gesture, event);
    state.set(size);
    gesture.display.show(size);
  };
  const up = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const active = gesture,
      size = resolveCanvasResize(active, event);
    release(active);
    void session
      .commit([
        {
          op: 'update',
          id: active.card.id,
          baseRevision: active.card.revision,
          patch: {
            width: size.width,
            height: size.height,
            ...(active.card.type === 'text'
              ? { data: { ...active.card.data, heightMode: 'fixed' } }
              : {}),
          },
        },
      ])
      .catch(report)
      .finally(() => {
        active.display.clear();
        void session.protect(active.card.id, [], 'resize').catch(report);
      });
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };
  return {
    state,
    start(card: CanvasCard, event: PointerEvent, zoom: number, display: CanvasResizeDisplay) {
      if (card.locked || event.button !== 0 || !(event.currentTarget instanceof HTMLElement))
        return;
      cancel();
      gesture = {
        card,
        pointer: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.currentTarget,
        zoom,
        display,
      };
      gesture.target.setPointerCapture(event.pointerId);
      state.set(card);
      gesture.target.addEventListener('pointermove', move);
      gesture.target.addEventListener('pointerup', up);
      gesture.target.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
      window.addEventListener('blur', cancel);
      void session
        .protect(
          card.id,
          card.type === 'text' ? ['width', 'height', 'data'] : ['width', 'height'],
          'resize'
        )
        .catch(report);
    },
    dispose: cancel,
  };
}
