import type {
  CanvasSurfaceRenderingOptions,
  CanvasSurfaceRendering,
} from './definitions/canvasSurfaceComposition';
import { createCanvasRasterPresentation } from './createCanvasRasterPresentation';
import { createCanvasEditorNavigation } from './createCanvasEditorNavigation';
/** 正文采样、可见内容刷新与编辑器导航共享同一 kernel。 */
export function createCanvasSurfaceRendering({
  options,
  ports,
  base,
  kernel,
  handleIntent,
}: CanvasSurfaceRenderingOptions): CanvasSurfaceRendering {
  const { readAppearance, report } = base;
  const raster = createCanvasRasterPresentation({
    host: options.stagingHost,
    kernel,
    readAppearance,
    reportFailure: report,
    createContent: ports.createContent,
    readContentKey: ports.readContentKey,
  });
  const refreshView = () => {
    ports.refreshVisibleContent?.(kernel.renderableCards());
    raster.refresh();
  };
  const navigate = createCanvasEditorNavigation(kernel, intent => {
    void handleIntent(intent).catch(report);
  });
  return { kernel, raster, refreshView, navigate, readAppearance };
}
