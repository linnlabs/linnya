import { CanvasCommandSchema, CanvasTextCardSchema, canvasAutomaticTextHeight, canvasImageHeight, type CanvasCommand } from '../../../../shared';
import type { CanvasArrangeOptions } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';
import type { CanvasWritePorts, CanvasWritePreparation } from '../definitions/canvasWritePorts';
import { buildCanvasUpdate, textCardNeedsMeasurement } from '../functions/buildCanvasUpdate';

/** 转换与排版在事务前完成；最终坐标和字段冲突仍由共同提交在最新状态上决定。 */
export async function prepareCanvasWrite(input: CanvasWritePreparation, ports: CanvasWritePorts) {
  const commands: CanvasCommand[] = [];
  const measurements: { ref: string; content: import('../../../../shared').CanvasTextDocument; width: number }[] = [];
  let arrange: CanvasArrangeOptions | undefined;
  for (const [index, operation] of input.operations.entries()) {
    input.signal.throwIfAborted();
    try {
      if (operation.op === 'arrange') { arrange = operation; continue; }
      if (operation.op === 'add') {
        const placement = { ref: operation.ref, width: operation.width, color: operation.color,
          near: operation.near ?? operation.after ?? operation.in, side: operation.side ?? 'right', parentId: operation.in };
        if (operation.type === 'text') {
          const content = await ports.parseText(operation.text);
          measurements.push({ ref: String(commands.length), content, width: operation.width });
          commands.push(CanvasCommandSchema.parse({ op: 'addText', ...placement, content, height: 64 }));
        } else if (operation.type === 'document') commands.push(CanvasCommandSchema.parse({ op: 'addDocument', ...placement, height: 180, data: { documentId: await ports.resolveDocument(operation.document) } }));
        else {
          const image = await ports.prepareImage(operation.file, input.dryRun);
          commands.push(CanvasCommandSchema.parse({ op: 'addImage', ...placement, height: canvasImageHeight(operation.width, image),
            data: { assetId: image.assetId, caption: operation.caption, alt: operation.alt, crop: null } }));
        }
      } else if (operation.op === 'update') {
        const current = input.snapshot.elements.find(element => element.id === operation.id);
        if (!current) throw new CanvasWriteFailure('element_missing', `找不到 ${operation.id}；新增卡请直接在 add 中写完整正文。`, index, 'id');
        const command = await buildCanvasUpdate(operation, current, ports);
        if (current.type !== 'edge' && textCardNeedsMeasurement(current, command.patch)) {
          const data = CanvasTextCardSchema.shape.data.parse(command.patch.data ?? current.data);
          measurements.push({ ref: String(commands.length), content: data.content, width: command.patch.width ?? current.width });
        }
        commands.push(command);
      } else if (operation.op === 'delete' || operation.op === 'disconnect') commands.push({ op: 'delete', id: operation.id, baseRevision: operation.revision });
      else commands.push(operation);
    } catch (error) {
      if (error instanceof CanvasWriteFailure) throw new CanvasWriteFailure(error.code, error.message, index, error.field);
      throw error;
    }
  }
  if (measurements.length) {
    const sizes = await ports.measure(measurements, input.signal);
    const measured = new Map(sizes.map(size => [size.ref, size.height]));
    for (const card of measurements) {
      const height = measured.get(card.ref);
      if (height === undefined) throw new Error('Canvas measured batch omitted a card');
      const index = Number(card.ref), command = commands[index];
      const bounded = canvasAutomaticTextHeight(height);
      if (command.op === 'addText') commands[index] = { ...command, height: bounded };
      else if (command.op === 'update') commands[index] = { ...command, patch: { ...command.patch, height: bounded } };
    }
  }
  return { operations: commands, arrange };
}
