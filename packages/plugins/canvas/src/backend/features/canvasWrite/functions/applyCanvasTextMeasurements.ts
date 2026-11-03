import { canvasAutomaticTextHeight, type CanvasCommand } from '../../../../shared';
import type { CanvasWriteTextMeasurement } from '../definitions/canvasPreparedOperation';

/** provider的ref指向准备后的命令位置；尺寸只回填文字新增/更新，不另建提交。 */
export function applyCanvasTextMeasurements(commands: readonly CanvasCommand[], measurements: readonly CanvasWriteTextMeasurement[], sizes: readonly { readonly ref: string; readonly height: number }[]): CanvasCommand[] {
  const result = [...commands], measured = new Map(sizes.map(size => [size.ref, size.height]));
  for (const card of measurements) {
    const height = measured.get(card.ref);
    if (height === undefined) throw new Error('Canvas measured batch omitted a card');
    const index = Number(card.ref), command = result[index], bounded = canvasAutomaticTextHeight(height);
    if (command.op === 'addText') result[index] = { ...command, height: bounded };
    else if (command.op === 'update') result[index] = { ...command, patch: { ...command.patch, height: bounded } };
  }
  return result;
}
