// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createCanvasPerformanceInputTrace } from '../performanceInputTrace';
import { CanvasCardIdSchema } from '../../../src/shared';

it('区分mainCanvas与其它DOM的真实事件目标并保留intent顺序，结束不再观察', () => {
  const canvas = document.createElement('canvas'), other = document.createElement('div'); document.body.append(canvas, other);
  const trace = createCanvasPerformanceInputTrace({ readCanvas: () => canvas, readState: point => ({ point, selection: ['c1'], renders: 2 }) });
  canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 30 }));
  other.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 25, clientY: 40 }));
  window.dispatchEvent(new FocusEvent('blur'));
  const id = CanvasCardIdSchema.parse('c1');
  trace.intent({ kind: 'move', ids: [id], positions: [{ id, x: 100, y: 100 }], dx: 5, dy: 10 });
  const result = trace.finish(), serialized = JSON.stringify(result);
  expect(serialized).toContain('"targetIsMainCanvas":true'); expect(serialized).toContain('"targetIsMainCanvas":false');
  expect(serialized).toContain('window-blur'); expect(serialized).toContain('"kind":"intent"'); expect(result.overflow).toBe(0);
  canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  expect(JSON.stringify(result)).toBe(serialized); canvas.remove(); other.remove();
});
