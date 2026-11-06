import { CanvasCommandSchema, canvasImageHeight, type CanvasCommand } from '../../../../shared';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';
import type { CanvasWritePorts } from '../definitions/canvasWritePorts';
import type {
  CanvasPreparedOperation,
  CanvasWriteOperationContext,
} from '../definitions/canvasPreparedOperation';
import { buildCanvasPropertyPatch } from '../functions/buildCanvasPropertyPatch';
import { readCanvasUpdateMeasurement } from '../functions/readCanvasUpdateMeasurement';
import { prepareCanvasTextUpdate } from './prepareCanvasTextUpdate';

async function prepareAddition(
  operation: Extract<CanvasCliOperation, { op: 'add' }>,
  context: CanvasWriteOperationContext,
  ports: CanvasWritePorts
): Promise<CanvasPreparedOperation> {
  const placement = {
    ref: operation.ref ?? `$__canvas_${context.operationIndex}`,
    width: operation.width,
    color: operation.color,
    near: operation.near ?? operation.after ?? operation.in,
    side: operation.side ?? 'right',
  };
  if (operation.type === 'text') {
    const content = await ports.parseText(operation.text);
    return {
      command: CanvasCommandSchema.parse({ op: 'addText', ...placement, content, height: 64 }),
      measurement: { ref: String(context.commandIndex), content, width: operation.width },
    };
  }
  if (operation.type === 'document') {
    const documentId = await ports.resolveDocument(operation.document);
    return {
      command: CanvasCommandSchema.parse({
        op: 'addDocument',
        ...placement,
        height: 180,
        data: { documentId },
      }),
    };
  }
  const image = await ports.prepareImage(operation.file, context.dryRun);
  return {
    command: CanvasCommandSchema.parse({
      op: 'addImage',
      ...placement,
      height: canvasImageHeight(operation.width, image),
      data: { assetId: image.assetId, caption: operation.caption, alt: operation.alt, crop: null },
    }),
  };
}
async function prepareUpdate(
  operation: Extract<CanvasCliOperation, { op: 'update' }>,
  context: CanvasWriteOperationContext,
  ports: CanvasWritePorts
): Promise<CanvasPreparedOperation> {
  const current = context.snapshot.elements.find(element => element.id === operation.id);
  if (!current)
    throw new CanvasWriteFailure(
      'element_missing',
      `找不到 ${operation.id}；新增卡请直接在 add 中写完整正文。`,
      context.operationIndex,
      'id'
    );
  const patch = buildCanvasPropertyPatch(operation, current),
    text = await prepareCanvasTextUpdate(operation, current, ports);
  const command: Extract<CanvasCommand, { op: 'update' }> = {
    op: 'update',
    id: operation.id,
    baseRevision: operation.revision,
    patch: { ...patch, ...text },
  };
  const measurement = readCanvasUpdateMeasurement(current, command);
  return {
    command,
    ...(measurement ? { measurement: { ref: String(context.commandIndex), ...measurement } } : {}),
  };
}

export async function prepareCanvasWriteOperation(
  operation: Exclude<CanvasCliOperation, { op: 'arrange' }>,
  context: CanvasWriteOperationContext,
  ports: CanvasWritePorts
): Promise<CanvasPreparedOperation> {
  if (operation.op === 'add') return prepareAddition(operation, context, ports);
  if (operation.op === 'update') return prepareUpdate(operation, context, ports);
  if (operation.op === 'delete' || operation.op === 'disconnect')
    return { command: { op: 'delete', id: operation.id, baseRevision: operation.revision } };
  return { command: operation };
}
