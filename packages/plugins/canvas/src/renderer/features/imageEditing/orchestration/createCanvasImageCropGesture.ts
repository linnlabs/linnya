import type { CanvasImageCrop, CanvasImageEditingState } from '../definitions/canvasImageEditing';
import { canvasImageCropFromPoints } from '../functions/canvasImageCrop';
export function createCanvasImageCropGesture(state: CanvasImageEditingState) {
  let gesture: { host: HTMLElement; id: number; start: { x: number; y: number }; before: CanvasImageCrop | null } | null = null;
  function point(event: PointerEvent, host: HTMLElement) { const rect = host.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; }
  function release() { const current = gesture; gesture = null; if (current?.host.hasPointerCapture(current.id)) current.host.releasePointerCapture(current.id); }
  return {
    down(event: PointerEvent) {
      if (event.button !== 0 || state.busy.value || !state.draft.value || !(event.currentTarget instanceof HTMLElement)) return;
      const host = event.currentTarget; gesture = { host, id: event.pointerId, start: point(event, host), before: state.draft.value.data.crop };
      host.setPointerCapture(event.pointerId); event.preventDefault();
    },
    move(event: PointerEvent) {
      if (!gesture || event.pointerId !== gesture.id) return;
      const crop = canvasImageCropFromPoints(gesture.start, point(event, gesture.host));
      if (crop) state.patch({ crop });
    },
    up(event: PointerEvent) { if (gesture?.id === event.pointerId) release(); },
    cancel() { if (gesture) state.patch({ crop: gesture.before }); release(); },
    dispose: release,
  };
}
