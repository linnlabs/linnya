import { CanvasCardIdSchema, type CanvasElement, type CanvasPatch } from '../../../../shared';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';

function buildCanvasEdgePropertyPatch(
  operation: Extract<CanvasCliOperation, { op: 'update' }>,
  current: CanvasElement
): CanvasPatch {
  if (
    operation.label === undefined &&
    operation.direction === undefined &&
    operation.lineStyle === undefined &&
    operation.linePattern === undefined
  )
    return {};
  if (current.type !== 'edge')
    throw new CanvasWriteFailure(
      'wrong_element_type',
      'label/direction/lineStyle/linePattern 只适用于连线。'
    );
  // 样式也沿共同提交修改同一实体，不靠断开重连丢失ID与已有改动历史。
  return {
    ...(operation.label === undefined ? {} : { label: operation.label }),
    ...(operation.direction === undefined ? {} : { direction: operation.direction }),
    ...(operation.lineStyle === undefined ? {} : { lineStyle: operation.lineStyle }),
    ...(operation.linePattern === undefined ? {} : { linePattern: operation.linePattern }),
  };
}

/** 分区标题只属于分区；归属只属于卡片，分区本身不进分区。 */
function buildCanvasSectionPatch(
  operation: Extract<CanvasCliOperation, { op: 'update' }>,
  current: CanvasElement
): CanvasPatch {
  let patch: CanvasPatch = {};
  if (operation.title !== undefined) {
    if (current.type !== 'section')
      throw new CanvasWriteFailure('wrong_element_type', 'title 只适用于分区。');
    patch = { data: { title: operation.title } };
  }
  if (operation.section === undefined) return patch;
  if (current.type === 'edge' || current.type === 'section')
    throw new CanvasWriteFailure(
      'wrong_element_type',
      'section 只适用于卡片，分区不能再放进分区。'
    );
  return {
    ...patch,
    parentId: operation.section === null ? null : CanvasCardIdSchema.parse(operation.section),
  };
}

export function buildCanvasPropertyPatch(
  operation: Extract<CanvasCliOperation, { op: 'update' }>,
  current: CanvasElement
): CanvasPatch {
  let patch = buildCanvasEdgePropertyPatch(operation, current);
  if (operation.color !== undefined) patch = { ...patch, color: operation.color };
  if (operation.locked !== undefined) patch = { ...patch, locked: operation.locked };
  if (operation.width !== undefined) {
    if (current.type === 'edge')
      throw new CanvasWriteFailure('wrong_element_type', '连线不能设置卡片宽度。');
    patch = { ...patch, width: operation.width };
  }
  patch = { ...patch, ...buildCanvasSectionPatch(operation, current) };
  if (operation.caption !== undefined || operation.alt !== undefined) {
    if (current.type !== 'image')
      throw new CanvasWriteFailure('wrong_element_type', 'caption/alt 只适用于图片卡。');
    patch = {
      ...patch,
      data: {
        ...current.data,
        ...(operation.caption === undefined ? {} : { caption: operation.caption }),
        ...(operation.alt === undefined ? {} : { alt: operation.alt }),
      },
    };
  }
  return patch;
}
