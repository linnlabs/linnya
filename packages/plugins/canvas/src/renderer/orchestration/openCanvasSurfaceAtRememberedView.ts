import { watch } from 'vue';
import { createCanvasViewMemory, resolveCanvasOpeningCamera } from '../features/viewMemory';
import type { CanvasSurfaceViewMemoryOptions } from './definitions/canvasSurfaceComposition';

/**
 * 打开文档并回到本机记住的视口，首次打开则适配全部卡片；之后每次平移缩放都记下来。
 * 返回关闭画布时调用的收尾：停止记录并立即写入最后位置。
 */
export async function openCanvasSurfaceAtRememberedView({
  options,
  base,
  rendering,
}: CanvasSurfaceViewMemoryOptions): Promise<() => void> {
  const { session, state, report, readAppearance } = base;
  const { kernel, refreshView } = rendering;
  const viewMemory = createCanvasViewMemory(options.documentId);
  try {
    kernel.setAppearance(readAppearance());
    await session.open(options.documentId);
    const opening = resolveCanvasOpeningCamera(
      viewMemory.read(),
      session.state.snapshot.value?.elements ?? [],
      { width: kernel.canvas.clientWidth, height: kernel.canvas.clientHeight }
    );
    if (opening) {
      kernel.setCamera(opening);
      state.setCamera(kernel.readCamera());
      refreshView();
    }
  } catch (failure) {
    report(failure);
  }
  const stopRemembering = watch(state.camera, camera => viewMemory.remember(camera));
  return () => {
    stopRemembering();
    viewMemory.flush();
  };
}
