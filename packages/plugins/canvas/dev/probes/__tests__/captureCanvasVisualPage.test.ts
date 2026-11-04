import { expect, it } from 'vitest';
import { captureCanvasVisualPage } from '../captureCanvasVisualPage';

const rectangles = [
  { x: 20, y: 20, width: 360, height: 500 },
  { x: 420, y: 20, width: 360, height: 500 },
  { x: 820, y: 20, width: 360, height: 500 },
] as const;

it.each([2, 4])('截图覆盖屏幕外第三幅正文并保持DPR%s的完整物理像素', async dpr => {
  const calls: { method: string; parameters: Record<string, unknown> }[] = [];
  let attached = false;
  const raw = Buffer.from('original-screenshot-png');
  const result = await captureCanvasVisualPage({
    attach() { attached = true; },
    detach() { attached = false; },
    async sendCommand(method, parameters) {
      expect(attached).toBe(true); calls.push({ method, parameters }); return { data: raw.toString('base64') };
    },
  }, { rectangles, zoomFactor: 2, dpr });
  // CI的窗口只有1024×728 DIP，但真实对照布局需要1180×520 CSS；不得把第三张截成0×0。
  expect(calls).toEqual([{ method: 'Page.captureScreenshot', parameters: {
    format: 'png', fromSurface: true, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 2360, height: 1040, scale: 1 },
  } }]);
  expect(result.expectedSize).toEqual({ width: 1180 * dpr, height: 520 * dpr });
  expect(result.png).toEqual(raw); expect(attached).toBe(false);
});

it('截图失败时释放本次debugger并传播原错，不回退到屏幕内残图', async () => {
  let attached = false;
  const failure = new Error('capture_failed');
  const execution = captureCanvasVisualPage({
    attach() { attached = true; }, detach() { attached = false; },
    async sendCommand() { throw failure; },
  }, { rectangles, zoomFactor: 2, dpr: 2 });
  await expect(execution).rejects.toBe(failure); expect(attached).toBe(false);
});
