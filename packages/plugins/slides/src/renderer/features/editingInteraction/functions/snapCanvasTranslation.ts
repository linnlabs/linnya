import type { RenderNodeSelectionRect } from '../../renderNodeSelection';
import type { CanvasSnapGuide } from '../definitions/canvasGesture';
import { INCHES_TO_PX } from '../../../shared/constants';

/** 阈值以屏幕像素解释；返回的修正 delta 同时用于绘制、命中和最终提交。 */
export function snapCanvasTranslation(input: {
  bounds: RenderNodeSelectionRect; peers: readonly RenderNodeSelectionRect[];
  slideSize: { width: number; height: number }; delta: { dx: number; dy: number };
  renderScale: number; disabled: boolean; axisLock: boolean;
}): { delta: { dx: number; dy: number }; guides: readonly CanvasSnapGuide[] } {
  let { dx, dy } = input.delta;
  const locked = input.axisLock ? (Math.abs(dx) >= Math.abs(dy) ? 'y' : 'x') : null;
  if (locked === 'x') dx = 0;
  if (locked === 'y') dy = 0;
  if (input.disabled) return { delta: { dx, dy }, guides: [] };
  const threshold = 6 / (INCHES_TO_PX * input.renderScale);
  const guides: CanvasSnapGuide[] = [];
  function snap(axis: 'x' | 'y', delta: number): number {
    if (locked === axis) return delta;
    const size = axis === 'x' ? 'w' : 'h';
    const extent = axis === 'x' ? input.slideSize.width : input.slideSize.height;
    const anchors = [0, extent / 2, extent, ...input.peers.flatMap(rect => [rect[axis], rect[axis] + rect[size] / 2, rect[axis] + rect[size]])];
    const moving = [input.bounds[axis], input.bounds[axis] + input.bounds[size] / 2, input.bounds[axis] + input.bounds[size]];
    let best: { correction: number; anchor: number } | null = null;
    for (const anchor of anchors) for (const value of moving) {
      const correction = anchor - (value + delta);
      if (Math.abs(correction) <= threshold && (!best || Math.abs(correction) < Math.abs(best.correction))) best = { correction, anchor };
    }
    if (!best) return delta;
    guides.push({ axis, position: best.anchor });
    return delta + best.correction;
  }
  return { delta: { dx: snap('x', dx), dy: snap('y', dy) }, guides };
}
