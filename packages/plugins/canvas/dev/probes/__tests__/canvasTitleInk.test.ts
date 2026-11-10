import { createCanvas } from '@napi-rs/canvas';
import { expect, it } from 'vitest';
import { canvasTitleInkMinimumIou, compareCanvasTitleInk } from '../visualOracle/compareCanvasTitleInk';

/** CPU真实字形只验证同一oracle能拒绝整列丢失，不代替Kernel/原生GPU像素验收。 */
it('四列60个真实字形同图通过，缺失B整列须由原IoU门拒绝，不能被大背景稀释', () => {
  const draw = (omitB: boolean) => {
    const canvas = createCanvas(900, 500), context = canvas.getContext('2d');
    context.fillStyle = '#f2f3ee'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#1b1b18'; context.font = '13px system-ui'; context.textBaseline = 'top';
    for (let index = 0; index < 60; index++) {
      const column = index % 4; if (omitB && column === 1) continue;
      context.fillText(`[主题${'ABCD'[column]}] 条目${index + 1}`, 20 + column * 210, 15 + Math.floor(index / 4) * 30);
    }
    return new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
  };
  const reference = draw(false), positive = compareCanvasTitleInk(reference, reference, 'ink');
  const negative = compareCanvasTitleInk(draw(true), reference, 'ink');
  expect(positive.union).toBeGreaterThan(0); expect(positive.iou).toBe(1);
  expect(negative.iou).toBeLessThan(canvasTitleInkMinimumIou);
  expect(negative.intersection).toBeLessThan(negative.union);
});
