import { expect, it } from 'vitest';
import { waitForCanvasPerformanceDraw } from '../waitForCanvasPerformanceDraw';

it('身份牌准备跨过多帧时不把第一个rAF当作真实draw，等待统计实际增加', async () => {
  let now = 0, frames = 0, renders = 4, completed = false;
  const result = waitForCanvasPerformanceDraw(renders, { readRenderCount: () => renders, now: () => now,
    nextFrame: async () => {
      now += 16; frames++;
      expect(completed).toBe(false);
      if (frames === 3) renders++;
    } }).then(() => { completed = true; });
  await result;
  expect(frames).toBe(3); expect(renders).toBe(5); expect(completed).toBe(true);
});

it('主draw没有兑现时有界失败，不调用capture或制造成功计数', async () => {
  let now = 0, frames = 0;
  await expect(waitForCanvasPerformanceDraw(0, { readRenderCount: () => 0, now: () => now,
    nextFrame: async () => { now += 1000; frames++; } })).rejects.toThrow('performance_first_draw_timeout');
  expect(frames).toBe(5); expect(now).toBe(5000);
});
