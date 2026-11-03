import type { CanvasCommand } from '../../../../shared';
import type { CanvasArrangeOptions } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';
import type { CanvasWritePorts, CanvasWritePreparation } from '../definitions/canvasWritePorts';
import type { CanvasWriteTextMeasurement } from '../definitions/canvasPreparedOperation';
import { applyCanvasTextMeasurements } from '../functions/applyCanvasTextMeasurements';
import { prepareCanvasWriteOperation } from './prepareCanvasWriteOperation';

/** 转换与排版在事务前完成；最终坐标和字段冲突仍由共同提交在最新状态上决定。 */
export async function prepareCanvasWrite(input: CanvasWritePreparation, ports: CanvasWritePorts) {
  const commands: CanvasCommand[] = [], measurements: CanvasWriteTextMeasurement[] = [];
  let arrange: CanvasArrangeOptions | undefined;
  for (const [index, operation] of input.operations.entries()) {
    input.signal.throwIfAborted();
    try {
      if (operation.op === 'arrange') {
        arrange = { algorithm: operation.algorithm, direction: operation.direction, elementIds: operation.elementIds, columns: operation.columns, groups: operation.groups }; continue;
      }
      const prepared = await prepareCanvasWriteOperation(operation, { snapshot: input.snapshot, dryRun: input.dryRun, operationIndex: index, commandIndex: commands.length }, ports);
      commands.push(prepared.command);
      if (prepared.measurement) measurements.push(prepared.measurement);
    } catch (error) {
      if (error instanceof CanvasWriteFailure) throw new CanvasWriteFailure(error.code, error.message, index, error.field);
      throw error;
    }
  }
  if (!measurements.length) return { operations: commands, arrange };
  const sizes = await ports.measure(measurements, input.signal);
  return { operations: applyCanvasTextMeasurements(commands, measurements, sizes), arrange };
}
