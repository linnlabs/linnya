import { watch } from 'vue';
import type { CanvasCard } from '@plugin/canvas/shared';
import type { CanvasKernel, CanvasAppearance } from '../kernel';
import type { CanvasDocumentSession } from '../features/canvasDocument';
import type { useCanvasPreferencesStore } from '../features/materialSetting';
import type { CanvasSurfacePorts } from '../definitions/canvasSurface';

/** 已提交场景、当前身份、主题与窗口尺寸共同投影到kernel；不承担用户提交。 */
export function installCanvasDisplayProjection(options: {
  readonly host: HTMLElement; readonly session: CanvasDocumentSession; readonly kernel: CanvasKernel;
  readonly raster: { refresh(): void }; readonly readAppearance: () => CanvasAppearance;
  readonly preferences: ReturnType<typeof useCanvasPreferencesStore>; readonly ports: CanvasSurfacePorts; readonly report: (failure: unknown) => void;
}) {
  let frame = 0;
  const stopContent = options.ports.subscribeContent?.(failure => {
    if (failure) { options.report(failure); return; }
    // 一批身份请求返回只重排一次地图标题，不让每个目标分别重绘整个场景。
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (options.ports.readDocumentTitles) options.kernel.setDocumentTitles(options.ports.readDocumentTitles()); options.raster.refresh(); });
  });
  const stopSnapshot = watch(options.session.state.snapshot, snapshot => {
    if (!snapshot) return;
    options.kernel.setElements(snapshot.elements); options.raster.refresh();
    const cards = snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge');
    void options.ports.refreshReferences?.(cards).catch(options.report);
  });
  const appearance = () => { options.kernel.setAppearance(options.readAppearance()); options.raster.refresh(); };
  const stopAppearance = watch(() => options.preferences.preferences, appearance);
  const observer = new ResizeObserver(() => { options.kernel.resize(options.host.clientWidth, options.host.clientHeight, devicePixelRatio); options.raster.refresh(); }); observer.observe(options.host);
  const theme = new MutationObserver(appearance); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  return () => { stopContent?.(); stopSnapshot(); stopAppearance(); observer.disconnect(); theme.disconnect(); if (frame) cancelAnimationFrame(frame); };
}
