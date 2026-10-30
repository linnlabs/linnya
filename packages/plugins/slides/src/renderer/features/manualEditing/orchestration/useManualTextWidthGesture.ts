import { onBeforeUnmount, shallowRef } from 'vue';
import type { ManualEditableTarget, ManualEditIntent, ManualEditingVisualPreview } from '../definitions/manualEditingTypes';
import { createManualTextWidthIntent, resolveManualTextWidth } from '../functions/manualTextWidth';
import type { ManualTextWidthHandle, ManualTextWidthResult } from '../definitions/manualTextWidth';

/** 手势冻结按下时的已呈现几何；连续预览不能把总位移反复累加到正在更新的 props。 */
export function useManualTextWidthGesture(options: {
  readTarget: () => ManualEditableTarget;
  readScale: () => number;
  preview: (preview: ManualEditingVisualPreview | null) => void;
  submit: (intent: ManualEditIntent) => void;
  dragging: (active: boolean) => void;
  finish: () => void;
}) {
  const result = shallowRef<ManualTextWidthResult | null>(null);
  let session: { target: ManualEditableTarget; scale: number; handle: ManualTextWidthHandle; pointerId: number; clientX: number; element: HTMLElement } | null = null;
  function down(handle: ManualTextWidthHandle, event: PointerEvent): void {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
    session = { target: options.readTarget(), scale: options.readScale(), handle,
      pointerId: event.pointerId, clientX: event.clientX, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    options.dragging(true);
  }
  function move(event: PointerEvent): void {
    if (!session || session.pointerId !== event.pointerId) return;
    result.value = resolveManualTextWidth(session.target, session.handle, event.clientX - session.clientX, session.scale);
    options.preview(result.value ? createManualTextWidthIntent(session.target, result.value).visualPreviews[0] : null);
  }
  function cancel(): void {
    const previous = session;
    if (!previous) return;
    session = null;
    result.value = null;
    options.preview(null);
    if (previous.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId);
    options.dragging(false);
    options.finish();
  }
  function up(event: PointerEvent): void {
    if (!session || session.pointerId !== event.pointerId) return;
    move(event);
    // 先交给队列保留预览，再释放指针；保存等待期间不闪回。
    if (result.value) options.submit(createManualTextWidthIntent(session.target, result.value));
    cancel();
  }
  onBeforeUnmount(cancel);
  return { result, down, move, up, cancel };
}
