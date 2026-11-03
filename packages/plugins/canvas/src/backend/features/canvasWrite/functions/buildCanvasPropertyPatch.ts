import type { CanvasElement, CanvasPatch } from '../../../../shared';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';

export function buildCanvasPropertyPatch(operation: Extract<CanvasCliOperation, { op: 'update' }>, current: CanvasElement): CanvasPatch {
  let patch: CanvasPatch = {};
  if (operation.color !== undefined) patch = { ...patch, color: operation.color };
  if (operation.locked !== undefined) patch = { ...patch, locked: operation.locked };
  if (operation.label !== undefined) {
    if (current.type !== 'edge') throw new CanvasWriteFailure('wrong_element_type', 'label 只适用于连线。');
    patch = { ...patch, label: operation.label };
  }
  if (operation.width !== undefined) {
    if (current.type === 'edge') throw new CanvasWriteFailure('wrong_element_type', '连线不能设置卡片宽度。');
    patch = { ...patch, width: operation.width };
  }
  if (operation.caption !== undefined || operation.alt !== undefined) {
    if (current.type !== 'image') throw new CanvasWriteFailure('wrong_element_type', 'caption/alt 只适用于图片卡。');
    patch = { ...patch, data: { ...current.data, ...(operation.caption === undefined ? {} : { caption: operation.caption }), ...(operation.alt === undefined ? {} : { alt: operation.alt }) } };
  }
  return patch;
}
