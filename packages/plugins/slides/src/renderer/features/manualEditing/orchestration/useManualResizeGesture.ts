import { onBeforeUnmount } from 'vue';
import type { ManualEditableTarget, ManualEditingVisualOperation, ManualEditingVisualPreview } from '../definitions/manualEditingTypes';
import type { ManualResizeHandle, ManualResizeStart } from '../definitions/manualResize';
import { resolveManualResize } from '../functions/manualResize';
import { createManualVisualPreview } from '../functions/manualVisualPreview';

export function useManualResizeGesture(options: {
  readonly readTarget: () => ManualEditableTarget;
  readonly readScale: () => number;
  readonly preview: (value: ManualEditingVisualPreview | null) => void;
  readonly submit: (operation: ManualEditingVisualOperation) => void;
  readonly finish: () => void;
}) {
  let session: { start: ManualResizeStart; pointerId: number; element: HTMLElement } | null = null;
  let operation: ReturnType<typeof resolveManualResize> = null;
  function clear(): void {
    const previous = session;
    session = null;
    operation = null;
    options.preview(null);
    if (previous?.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId);
  }
  function cancel(): void {
    if (!session) return;
    clear();
    options.finish();
  }
  function down(handle: ManualResizeHandle, event: PointerEvent): void {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
    const target = options.readTarget();
    session = {
      start: { target, handle, clientX: event.clientX, clientY: event.clientY, renderScale: options.readScale() },
      pointerId: event.pointerId, element: event.currentTarget,
    };
    operation = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  }
  function move(event: PointerEvent): void {
    if (!session || session.pointerId !== event.pointerId) return;
    if (!operation && Math.hypot(event.clientX - session.start.clientX, event.clientY - session.start.clientY) < 3) return;
    operation = resolveManualResize(session.start, event.clientX, event.clientY);
    options.preview(operation ? createManualVisualPreview(session.start.target, operation) : null);
  }
  function up(event: PointerEvent): void {
    if (!session || session.pointerId !== event.pointerId) return;
    move(event);
    const finalOperation = operation;
    // 先把最终值交给既有队列，再撤下手势预览，松手不闪回。
    if (finalOperation) options.submit(finalOperation);
    cancel();
  }
  onBeforeUnmount(clear);
  return { down, move, up, cancel };
}
