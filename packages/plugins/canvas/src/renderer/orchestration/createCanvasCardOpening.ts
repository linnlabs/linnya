import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../kernel';
import { canvasEditingCamera } from '../functions/canvasEditingCamera';

/** 进入正文前等待精确位图；切换选择或关闭后不接纳旧异步请求。 */
export function createCanvasCardOpening(options: {
  readonly kernel: Pick<CanvasKernel, 'readCamera' | 'setCamera' | 'finishTransitions'>;
  readonly readCard: (id: CanvasCardId) => CanvasCard | undefined;
  readonly finish: () => Promise<boolean>;
  readonly cameraChanged: () => void;
  readonly prepare: (id: CanvasCardId) => Promise<'ready' | 'unavailable'>;
  readonly openText: (id: CanvasCardId, signal: AbortSignal) => Promise<void>;
  readonly openMedia: (card: CanvasCard) => Promise<void> | undefined;
  readonly unavailable: () => void;
  readonly opened?: (id: CanvasCardId) => void;
}) {
  let generation = 0,
    disposed = false;
  let cancellation: AbortController | null = null;
  return {
    async open(id: CanvasCardId) {
      cancellation?.abort();
      const controller = new AbortController();
      cancellation = controller;
      const token = ++generation;
      if (!(await options.finish())) return;
      if (disposed || token !== generation) return;
      options.kernel.finishTransitions([id]);
      const card = options.readCard(id);
      if (!card) return;
      if (card.type !== 'text') {
        await options.openMedia(card);
        return;
      }
      const camera = canvasEditingCamera(card, options.kernel.readCamera());
      if (camera) {
        options.kernel.setCamera(camera);
        options.cameraChanged();
      }
      const prepared = await options.prepare(id);
      if (disposed || token !== generation) return;
      if (prepared === 'unavailable') options.unavailable();
      await options.openText(id, controller.signal);
      if (!disposed && token === generation) options.opened?.(id);
    },
    cancel() {
      generation += 1;
      cancellation?.abort();
    },
    dispose() {
      disposed = true;
      generation += 1;
      cancellation?.abort();
    },
  };
}
