import type { RenderBox } from '../renderModel';

/**
 * RenderModel 与 OOXML 的旋转均绕未旋转外框中心。局部内容仍以左上角为原点，
 * 因此变换必须依次平移到中心、旋转、减去局部中心；不能让适配器各选一个原点。
 * unitScale 只作英寸到目标单位的换算，选择几何保留 1，Canvas 使用每英寸像素数。
 */
export function resolveBoxRotation(
  box: Pick<RenderBox, 'x' | 'y' | 'w' | 'h'>,
  rotation = 0,
  unitScale = 1,
): { x: number; y: number; offsetX: number; offsetY: number; rotation: number } {
  const offsetX = box.w * unitScale / 2;
  const offsetY = box.h * unitScale / 2;
  return {
    x: box.x * unitScale + offsetX,
    y: box.y * unitScale + offsetY,
    offsetX,
    offsetY,
    rotation,
  };
}
