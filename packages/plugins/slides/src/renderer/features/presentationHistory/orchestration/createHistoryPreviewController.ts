import type { PresentationRenderModel } from '@plugin/slides/shared';

export interface HistoryPreviewState {
  readonly model: PresentationRenderModel | null;
  readonly bitmap: ImageBitmap | null;
  readonly pageIndex: number;
  readonly phase: 'loading' | 'ready' | 'failed';
}

/** 只保留选中版本和选中页；过期图片立即 close，不进入当前文稿 store。 */
export function createHistoryPreviewController(input: {
  readonly read: () => Promise<PresentationRenderModel>;
  readonly render: (
    model: PresentationRenderModel,
    pageIndex: number,
    signal: AbortSignal
  ) => Promise<ImageBitmap>;
  readonly publish: (state: HistoryPreviewState) => void;
  readonly report: (error: unknown) => void;
}) {
  let model: PresentationRenderModel | null = null;
  let bitmap: ImageBitmap | null = null;
  let generation = 0;
  let disposed = false;
  let abort: AbortController | undefined;
  const publish = (pageIndex: number, phase: HistoryPreviewState['phase']) =>
    input.publish({ model, bitmap, pageIndex, phase });
  async function select(pageIndex: number): Promise<void> {
    if (!model || disposed) return;
    const ticket = ++generation;
    abort?.abort();
    abort = new AbortController();
    bitmap?.close();
    bitmap = null;
    publish(pageIndex, 'loading');
    try {
      const next = await input.render(model, pageIndex, abort.signal);
      if (disposed || ticket !== generation) {
        next.close();
        return;
      }
      bitmap = next;
      publish(pageIndex, 'ready');
    } catch (error) {
      if (!disposed && ticket === generation) {
        input.report(error);
        publish(pageIndex, 'failed');
      }
    }
  }
  return {
    select,
    async load() {
      try {
        const next = await input.read();
        if (disposed) return;
        model = next;
        await select(0);
      } catch (error) {
        if (!disposed) {
          input.report(error);
          publish(0, 'failed');
        }
      }
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      bitmap?.close();
      bitmap = null;
      model = null;
    },
  };
}
