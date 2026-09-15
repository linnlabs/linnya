import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../shared/constants';
import type { ManualEditableTarget, ManualEditingVisualOperation } from '../definitions/manualEditingTypes';
import type { ManualResizeHandle, ManualResizeStart } from '../definitions/manualResize';

export function canResizeManualTarget(
  target: ManualEditableTarget,
): target is ManualEditableTarget & { readonly targetKind: 'shape' | 'image' } {
  return (target.targetKind === 'shape' || target.targetKind === 'image')
    && target.capabilities.includes('set_visual_size');
}

/** 固定局部左上角，只改变视觉宽高。旋转对象将屏幕位移投影到自己的坐标轴。 */
export function resolveManualResize(
  start: ManualResizeStart,
  clientX: number,
  clientY: number,
): Extract<ManualEditingVisualOperation, { op: 'set_visual_size' }> | null {
  const target = start.target;
  if (!canResizeManualTarget(target)) return null;
  const [origin, right, , bottom] = target.polygon;
  if (!origin || !right || !bottom) return null;
  const width = Math.hypot(right.x - origin.x, right.y - origin.y);
  const height = Math.hypot(bottom.x - origin.x, bottom.y - origin.y);
  if (width === 0 || height === 0) return null;
  const dx = (clientX - start.clientX) / (INCHES_TO_PX * start.renderScale);
  const dy = (clientY - start.clientY) / (INCHES_TO_PX * start.renderScale);
  const localX = (dx * (right.x - origin.x) + dy * (right.y - origin.y)) / width;
  const localY = (dx * (bottom.x - origin.x) + dy * (bottom.y - origin.y)) / height;
  let nextWidth = start.handle === 'bottom' ? width : Math.max(0.05, width + localX);
  let nextHeight = start.handle === 'right' ? height : Math.max(0.05, height + localY);
  if (target.targetKind === 'image') {
    // 角点拖拽投影到原对角线；不会因为选择横向还是纵向变化而忽然跳尺寸。
    const scale = start.handle === 'right' ? nextWidth / width
      : start.handle === 'bottom' ? nextHeight / height
        : 1 + (localX * width + localY * height) / (width * width + height * height);
    const bounded = Math.max(scale, 0.05 / Math.min(width, height));
    nextWidth = width * bounded;
    nextHeight = height * bounded;
  }
  if (Math.abs(nextWidth - width) < 1e-9 && Math.abs(nextHeight - height) < 1e-9) return null;
  return {
    op: 'set_visual_size', target: target.authoringRef, targetKind: target.targetKind,
    visualSize: { width: nextWidth, height: nextHeight },
  };
}

export function manualResizeHandleStyle(
  target: ManualEditableTarget,
  handle: ManualResizeHandle,
  viewport: { readonly slideLeft: number; readonly slideTop: number; readonly renderScale: number },
): Readonly<Record<string, string>> {
  const [origin, right, corner, bottom] = target.polygon;
  if (!origin || !right || !corner || !bottom) return {};
  const point = handle === 'corner' ? corner : handle === 'right'
    ? { x: (right.x + corner.x) / 2, y: (right.y + corner.y) / 2 }
    : { x: (bottom.x + corner.x) / 2, y: (bottom.y + corner.y) / 2 };
  const rotation = Math.atan2(right.y - origin.y, right.x - origin.x) * 180 / Math.PI;
  const angle = rotation + (handle === 'right' ? 0 : handle === 'bottom' ? 90 : 45);
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return {
    // DOM 手柄沿用 Canvas 选框的颜色合同，避免一组选框出现两种强调色。
    '--slides-resize-color': SLIDES_RENDER_COLORS.manualEditingStroke,
    '--slides-resize-x': `${viewport.slideLeft + point.x * INCHES_TO_PX * viewport.renderScale}px`,
    '--slides-resize-y': `${viewport.slideTop + point.y * INCHES_TO_PX * viewport.renderScale}px`,
    '--slides-resize-cursor': cursors[((Math.round(angle / 45) % 4) + 4) % 4] ?? 'nwse-resize',
  };
}
