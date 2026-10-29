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
  /** 最近一次指针位置；只按下或松开 Shift 时也用它重算，不必再动鼠标。 */
  let pointer = { clientX: 0, clientY: 0, keepAspect: false };
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
    pointer = { clientX: event.clientX, clientY: event.clientY, keepAspect: event.shiftKey };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  }
  function update(): void {
    if (!session) return;
    operation = resolveManualResize(session.start, pointer.clientX, pointer.clientY, pointer.keepAspect);
    options.preview(operation ? createManualVisualPreview(session.start.target, operation) : null);
  }
  function move(event: PointerEvent): void {
    if (!session || session.pointerId !== event.pointerId) return;
    if (!operation && Math.hypot(event.clientX - session.start.clientX, event.clientY - session.start.clientY) < 3) return;
    pointer = { clientX: event.clientX, clientY: event.clientY, keepAspect: event.shiftKey };
    update();
  }
  function modifier(event: KeyboardEvent): void {
    if (!session || event.key !== 'Shift' || event.shiftKey === pointer.keepAspect) return;
    pointer = { ...pointer, keepAspect: event.shiftKey };
    if (operation) update();
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
  return { down, move, up, cancel, modifier };
}
