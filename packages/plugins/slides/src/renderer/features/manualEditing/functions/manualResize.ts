import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../shared/constants';
import type { ManualEditableTarget, ManualEditingVisualOperation } from '../definitions/manualEditingTypes';
import { MANUAL_RESIZE_DIRECTIONS, type ManualResizeHandle, type ManualResizeStart } from '../definitions/manualResize';

export function canResizeManualTarget(
  target: ManualEditableTarget,
): target is ManualEditableTarget & { readonly targetKind: 'shape' | 'image' } {
  return (target.targetKind === 'shape' || target.targetKind === 'image')
    && target.capabilities.includes('set_visual_size');
}

/** 固定对侧锚点，尺寸与锚点补偿一起提交。旋转对象先将屏幕位移投影到局部坐标轴。 */
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
  const [horizontal, vertical] = MANUAL_RESIZE_DIRECTIONS[start.handle];
  let nextWidth = horizontal === 0 ? width : Math.max(0.05, width + horizontal * localX);
  let nextHeight = vertical === 0 ? height : Math.max(0.05, height + vertical * localY);
  if (target.targetKind === 'image') {
    // 角点沿原对角线连续缩放；边中点以对边中点为锚，另一轴对称变化。
    const scale = vertical === 0 ? nextWidth / width
      : horizontal === 0 ? nextHeight / height
        : 1 + (horizontal * localX * width + vertical * localY * height) / (width * width + height * height);
    const bounded = Math.max(scale, 0.05 / Math.min(width, height));
    nextWidth = width * bounded;
    nextHeight = height * bounded;
  }
  const shiftX = (width - nextWidth) * (1 - horizontal) / 2;
  const shiftY = (height - nextHeight) * (1 - vertical) / 2;
  const translationDelta = {
    dx: shiftX * (right.x - origin.x) / width + shiftY * (bottom.x - origin.x) / height,
    dy: shiftX * (right.y - origin.y) / width + shiftY * (bottom.y - origin.y) / height,
  };
  if (Math.abs(nextWidth - width) < 1e-9 && Math.abs(nextHeight - height) < 1e-9) return null;
  return {
    op: 'set_visual_size', target: target.authoringRef, targetKind: target.targetKind,
    visualSize: { width: nextWidth, height: nextHeight },
    ...(Math.abs(translationDelta.dx) > 1e-9 || Math.abs(translationDelta.dy) > 1e-9 ? { translationDelta } : {}),
  };
}

export function manualResizeHandleStyle(
  target: ManualEditableTarget,
  handle: ManualResizeHandle,
  viewport: { readonly slideLeft: number; readonly slideTop: number; readonly renderScale: number },
): Readonly<Record<string, string>> {
  const [origin, right, corner, bottom] = target.polygon;
  if (!origin || !right || !corner || !bottom) return {};
  const [horizontal, vertical] = MANUAL_RESIZE_DIRECTIONS[handle];
  const point = {
    x: origin.x + (right.x - origin.x) * (horizontal + 1) / 2 + (bottom.x - origin.x) * (vertical + 1) / 2,
    y: origin.y + (right.y - origin.y) * (horizontal + 1) / 2 + (bottom.y - origin.y) * (vertical + 1) / 2,
  };
  const rotation = Math.atan2(right.y - origin.y, right.x - origin.x) * 180 / Math.PI;
  const angle = rotation + Math.atan2(vertical, horizontal) * 180 / Math.PI;
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return {
    // DOM 手柄沿用 Canvas 选框的颜色合同，避免一组选框出现两种强调色。
    '--slides-resize-color': SLIDES_RENDER_COLORS.manualEditingStroke,
    '--slides-resize-x': `${viewport.slideLeft + point.x * INCHES_TO_PX * viewport.renderScale}px`,
    '--slides-resize-y': `${viewport.slideTop + point.y * INCHES_TO_PX * viewport.renderScale}px`,
    '--slides-resize-cursor': cursors[((Math.round(angle / 45) % 4) + 4) % 4] ?? 'nwse-resize',
  };
}
