import type { CanvasImageCrop } from '../definitions/canvasImageEditing';
export const fullCanvasImageCrop: CanvasImageCrop = { x: 0, y: 0, width: 1, height: 1 };
export function canvasImageCropFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): CanvasImageCrop | null {
  const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
export function canvasImageCropInset(crop: CanvasImageCrop, side: 'left' | 'top' | 'right' | 'bottom', percent: number): CanvasImageCrop {
  const value = Math.max(0, Math.min(0.99, percent / 100));
  if (side === 'left') { const right = crop.x + crop.width; const x = Math.min(value, right - Math.min(0.01, crop.width)); return { ...crop, x, width: right - x }; }
  if (side === 'top') { const bottom = crop.y + crop.height; const y = Math.min(value, bottom - Math.min(0.01, crop.height)); return { ...crop, y, height: bottom - y }; }
  if (side === 'right') return { ...crop, width: Math.max(Math.min(0.01, 1 - crop.x), 1 - value - crop.x) };
  return { ...crop, height: Math.max(Math.min(0.01, 1 - crop.y), 1 - value - crop.y) };
}
