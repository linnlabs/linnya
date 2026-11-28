import { nextTick, shallowRef } from 'vue';
import {
  createDocumentPreviewSurface,
  type DocumentPreviewSurfaceInput,
} from '@linnya/document-preview';
import { createDocumentPreviewDetailState } from '../store/documentPreviewDetailState';

/**
 * 新表面构建期间取消旧的在途构建，图片/图表迟到时不能覆盖换范围后的预览。
 * 已显示的旧表面留到新表面就绪再原地替换：宽度或主题一变就先清空，会空白几帧。
 * 正文把构建信号当作自己的释放信号，所以已显示表面的信号不再取消，只经 dispose 释放。
 */
export function createReadonlyDocumentSurface(input: {
  element: () => HTMLElement | null;
  report: (error: unknown) => void;
  ready: () => void;
  build?: typeof createDocumentPreviewSurface;
}) {
  const state = createDocumentPreviewDetailState();
  const body = shallowRef<HTMLElement | null>(null);
  // 当前显示的表面是不是首屏，以及首屏是否被最大高度截断（没截断说明全文已在眼前，不必再换全文）。
  // 都随已显示的表面更新，而不是随请求更新：全文请求发出到排好之间，界面仍按首屏呈现。
  const firstScreen = shallowRef(false),
    clipped = shallowRef(false);
  let active: AbortController | undefined, release: (() => void) | undefined;
  function clear() {
    active?.abort();
    active = undefined;
    release?.();
    release = undefined;
    body.value = null;
    firstScreen.value = false;
    clipped.value = false;
    state.set('idle');
  }
  return {
    phase: state.phase,
    body,
    firstScreen,
    clipped,
    clear,
    async render(
      options: Omit<DocumentPreviewSurfaceInput, 'document' | 'signal'>,
      isCurrent: () => boolean
    ) {
      active?.abort();
      const cancellation = new AbortController();
      active = cancellation;
      state.set('loading');
      try {
        await nextTick();
        const element = input.element();
        if (!element || cancellation.signal.aborted || !isCurrent()) return;
        const result = await (input.build ?? createDocumentPreviewSurface)({
          ...options,
          document: element.ownerDocument,
          signal: cancellation.signal,
        });
        if (cancellation.signal.aborted || !isCurrent()) {
          result.dispose();
          return;
        }
        element.replaceChildren(result.element);
        release?.();
        release = result.dispose;
        if (active === cancellation) active = undefined;
        body.value = result.body;
        firstScreen.value = result.element.classList.contains('document-preview-first-screen');
        clipped.value = result.element.classList.contains('document-preview-clipped');
        state.set('ready');
        input.ready();
      } catch (failure) {
        if (!cancellation.signal.aborted && isCurrent()) {
          release?.();
          release = undefined;
          body.value = null;
          firstScreen.value = false;
          clipped.value = false;
          state.set('failed');
          input.report(failure);
        }
      }
    },
  };
}
