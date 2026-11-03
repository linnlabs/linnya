import type { CanvasCard, CanvasCommand, CanvasElement, CanvasPatch } from '../../../../shared';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';
import type { CanvasWritePorts } from '../definitions/canvasWritePorts';

export async function buildCanvasUpdate(operation: Extract<CanvasCliOperation, { op: 'update' }>, current: CanvasElement, ports: CanvasWritePorts): Promise<Extract<CanvasCommand, { op: 'update' }>> {
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
  if (operation.text !== undefined || operation.append !== undefined) {
    if (current.type !== 'text') throw new CanvasWriteFailure('wrong_element_type', 'text/append 只适用于文字卡。');
    let content = current.data.content;
    if (operation.text !== undefined) content = await ports.parseText(operation.text, { elementId: current.id, revision: operation.revision, mode: 'replace' });
    else if (operation.append !== undefined) {
      // 追加只解析新块，保留原有标签和图片身份，避免Markdown往返抹掉稳定attrs。
      const parsed = await ports.parseText(operation.append, { elementId: current.id, revision: operation.revision, mode: 'append' });
      content = { ...current.data.content, content: [...current.data.content.content, ...parsed.content] };
    }
    patch = { ...patch, data: { ...current.data, content } };
  }
  return { op: 'update', id: operation.id, baseRevision: operation.revision, patch };
}

export function textCardNeedsMeasurement(card: CanvasCard, patch: CanvasPatch): boolean {
  return card.type === 'text' && card.data.heightMode === 'auto' && (patch.data !== undefined || patch.width !== undefined);
}
