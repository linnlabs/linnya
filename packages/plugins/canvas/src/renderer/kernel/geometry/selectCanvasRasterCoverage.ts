import type { CanvasRectangle } from '../../../shared';

/** 分档图可向下复用；精确编辑倍率只接受相同采样比例，不把高倍缩小冒充原生排版。 */
export function selectCanvasRasterCoverage<T extends CanvasRectangle & { readonly scale: number }>(
  resources: readonly T[], request: { readonly scale: number; readonly exact: boolean },
): readonly T[] {
  return resources.filter(resource => request.exact ? resource.scale === request.scale : resource.scale >= request.scale);
}
