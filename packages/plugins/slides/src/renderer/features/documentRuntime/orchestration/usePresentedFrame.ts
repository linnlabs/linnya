import { onScopeDispose, watch, type Ref } from 'vue';
import type { PresentationFrame } from '../definitions/documentPresentation';
import { useSlidesDocumentRuntime } from './useSlidesDocumentRuntime';

/** 资源准备完成后跨过绘制边界；卸载会撤销回执，旧视图不能替新视图宣告完成。 */
export function usePresentedFrame(frame: Ref<PresentationFrame | null>): void {
  const runtime = useSlidesDocumentRuntime();
  let pending: number | null = null;
  function cancel(): void {
    if (pending !== null) cancelAnimationFrame(pending);
    pending = null;
  }
  watch(frame, value => {
    cancel();
    if (!value) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      runtime.reportPresentedFrame(value);
    });
  }, { immediate: true, flush: 'post' });
  onScopeDispose(cancel);
}
