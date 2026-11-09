import { nextTick, shallowRef } from 'vue';
import { createDocumentPreviewSurface, type DocumentPreviewSurfaceInput } from '@linnya/document-preview';
import { createDocumentPreviewDetailState } from '../store/documentPreviewDetailState';

/** 取消旧呈现后才构建新表面；图片/图表迟到时不能覆盖换范围后的预览。 */
export function createReadonlyDocumentSurface(input: {
  element: () => HTMLElement | null;
  report: (error: unknown) => void;
  ready: () => void;
  build?: typeof createDocumentPreviewSurface;
}) {
  const state = createDocumentPreviewDetailState();
  const body = shallowRef<HTMLElement | null>(null);
  let active: AbortController | undefined, release: (() => void) | undefined;
  function clear() {
    active?.abort(); active = undefined;
    release?.(); release = undefined;
    body.value = null;
    state.set('idle');
  }
  return {
    phase: state.phase, body, clear,
    async render(options: Omit<DocumentPreviewSurfaceInput, 'document' | 'signal'>, isCurrent: () => boolean) {
      clear();
      const cancellation = new AbortController(); active = cancellation;
      state.set('loading');
      try {
        await nextTick();
        const element = input.element();
        if (!element || cancellation.signal.aborted || !isCurrent()) return;
        const result = await (input.build ?? createDocumentPreviewSurface)({
          ...options, document: element.ownerDocument, signal: cancellation.signal,
        });
        if (cancellation.signal.aborted || !isCurrent()) { result.dispose(); return; }
        element.replaceChildren(result.element); release = result.dispose;
        body.value = result.body; state.set('ready'); input.ready();
      } catch (failure) {
        if (!cancellation.signal.aborted && isCurrent()) { state.set('failed'); input.report(failure); }
      }
    },
  };
}
