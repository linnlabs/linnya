import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../kernel';
import { canvasEditingCamera } from '../functions/canvasEditingCamera';

/** 进入正文前等待精确位图；切换选择或关闭后不接纳旧异步请求。 */
export function createCanvasCardOpening(options: {
  readonly kernel: Pick<CanvasKernel, 'readCamera' | 'setCamera'>;
  readonly readCard: (id: CanvasCardId) => CanvasCard | undefined;
  readonly finish: () => Promise<boolean>;
  readonly cameraChanged: () => void;
  readonly prepare: (id: CanvasCardId) => Promise<'ready' | 'unavailable'>;
  readonly openText: (id: CanvasCardId) => Promise<void>;
  readonly openMedia: (card: CanvasCard) => Promise<void> | undefined;
  readonly unavailable: () => void;
}) {
  let generation = 0, disposed = false;
  return {
    async open(id: CanvasCardId) {
      const token = ++generation, card = options.readCard(id);
      if (!card || !(await options.finish())) return;
      if (card.type !== 'text') { await options.openMedia(card); return; }
      const camera = canvasEditingCamera(card, options.kernel.readCamera());
      if (camera) { options.kernel.setCamera(camera); options.cameraChanged(); }
      const prepared = await options.prepare(id);
      if (disposed || token !== generation) return;
      if (prepared === 'unavailable') options.unavailable();
      await options.openText(id);
    },
    cancel() { generation += 1; },
    dispose() { disposed = true; generation += 1; },
  };
}
