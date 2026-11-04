import type { CanvasWorkerRequest } from '../definitions/canvasRendering';

/** 测高只需真实可布局视口；长正文仍在DOM中测量，不分配整张长卡窗口。 */
export function canvasWorkerViewport(request: CanvasWorkerRequest): { readonly width: number; readonly height: number } {
  const width = request.kind === 'measureBatch' ? Math.max(...request.cards.map(card => card.width)) : request.width;
  const height = request.kind === 'render' ? request.height : 64;
  // 最小4物理像素在最高DPR仍有非零CSS布局视口；出图尺寸继续由原请求拥有。
  return { width: Math.max(4, Math.ceil(width * request.dpr)), height: Math.max(4, Math.ceil(height * request.dpr)) };
}
