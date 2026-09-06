import type { HistoryPreviewPort, HistoryPreviewState } from '../definitions/historyPreview';

/** 只渲染并保留选中页，旧请求不能把图片写入新页。 */
export function createHistoryPreviewController(input: HistoryPreviewPort) {
  let model: HistoryPreviewState['model'] = null;
  let bitmap: ImageBitmap | null = null;
  let generation = 0;
  let disposed = false;
  let abort: AbortController | undefined;
  const publish = (pageIndex: number, phase: HistoryPreviewState['phase']) =>
    input.publish({ model, bitmap, pageIndex, phase });
  function release(): void {
    bitmap?.close();
    bitmap = null;
  }
  async function select(pageIndex: number): Promise<void> {
    if (!model || disposed || pageIndex < 0 || pageIndex >= model.slides.length) return;
    const ticket = ++generation;
    abort?.abort();
    abort = new AbortController();
    release();
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
        if (model.slides.length === 0) {
          publish(0, 'empty');
          return;
        }
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
      release();
      model = null;
    },
  };
}
