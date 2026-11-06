import { watch } from 'vue';
import type { CanvasCard } from '@plugin/canvas/shared';
import type { CanvasKernel, CanvasAppearance } from '../kernel';
import type { CanvasDocumentSession } from '../features/canvasDocument';
import type { useCanvasPreferencesStore } from '../features/materialSetting';
import type { CanvasSurfacePorts, CanvasViewportSize } from '../definitions/canvasSurface';
import { canvasProjectionMotion } from '../functions/canvasProjectionMotion';
import { installCanvasResolutionObserver } from './installCanvasResolutionObserver';

/** 已提交场景、当前身份、主题与窗口尺寸共同投影到kernel；不承担用户提交。 */
export function installCanvasDisplayProjection(options: {
  readonly host: HTMLElement;
  readonly session: Pick<CanvasDocumentSession, 'state'>;
  readonly kernel: Pick<
    CanvasKernel,
    'setDocumentTitles' | 'setThumbnailCards' | 'setElements' | 'setAppearance' | 'resize'
  >;
  readonly raster: { refresh(): void };
  readonly readAppearance: () => CanvasAppearance;
  readonly preferences: ReturnType<typeof useCanvasPreferencesStore>;
  readonly ports: CanvasSurfacePorts;
  readonly report: (failure: unknown) => void;
  readonly refreshEditorInk?: () => void;
  readonly viewportChanged: (size: CanvasViewportSize) => void;
}) {
  let scheduled = false,
    disposed = false;
  const stopContent = options.ports.subscribeContent?.(failure => {
    if (failure) {
      options.report(failure);
      return;
    }
    // 一批身份请求返回只重排一次地图标题，不让每个目标分别重绘整个场景。
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      if (options.ports.readDocumentTitles)
        options.kernel.setDocumentTitles(options.ports.readDocumentTitles());
      const cards =
        options.session.state.snapshot.value?.elements.filter(
          (element): element is CanvasCard => element.type !== 'edge'
        ) ?? [];
      if (options.ports.readThumbnailCards)
        options.kernel.setThumbnailCards(options.ports.readThumbnailCards(cards));
      options.raster.refresh();
    });
  });
  const stopSnapshot = watch(
    options.session.state.projection,
    projection => {
      if (!projection) return;
      const snapshot = projection.snapshot;
      options.kernel.setElements(snapshot.elements, canvasProjectionMotion(projection));
      options.raster.refresh();
      const cards = snapshot.elements.filter(
        (element): element is CanvasCard => element.type !== 'edge'
      );
      void options.ports.refreshReferences?.(cards).catch(options.report);
    },
    { flush: 'sync' }
  );
  const appearance = () => {
    options.kernel.setAppearance(options.readAppearance());
    options.refreshEditorInk?.();
    options.raster.refresh();
  };
  const stopAppearance = watch(() => options.preferences.preferences, appearance);
  const resized = () => {
    const size = { width: options.host.clientWidth, height: options.host.clientHeight };
    options.kernel.resize(size.width, size.height, devicePixelRatio);
    options.viewportChanged(size);
    options.raster.refresh();
  };
  const observer = new ResizeObserver(resized);
  observer.observe(options.host);
  const stopResolution = installCanvasResolutionObserver(resized);
  // 根外观属性也包含Host字体抗锯齿设置；观察同批属性，不依赖Host私有常量。
  const theme = new MutationObserver(appearance);
  theme.observe(document.documentElement, { attributes: true });
  return () => {
    disposed = true;
    stopContent?.();
    stopSnapshot();
    stopAppearance();
    observer.disconnect();
    stopResolution();
    theme.disconnect();
  };
}
