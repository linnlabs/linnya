import { describe, expect, it } from 'vitest';
import { createSceneVisualClock } from '../sceneVisualClock';

describe('isolated scene visual logical time', () => {
  it('keeps native timers live while animation progress is fixed and restores the original clock', async () => {
    const original = performance.now, descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    const clock = createSceneVisualClock();
    try {
      expect(performance.now()).toBe(0);
      clock.advance(64);
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      expect(performance.now()).toBe(64);
      expect(() => clock.advance(-1)).toThrow('monotonically');
      clock.advance(56); expect(performance.now()).toBe(120);
    } finally { clock.restore(); }
    expect(performance.now).toBe(original);
    expect(Object.getOwnPropertyDescriptor(performance, 'now')).toEqual(descriptor);
  });

  it('observes actual asynchronous work without advancing logical animation time', async () => {
    const original = performance.now, clock = createSceneVisualClock();
    try {
      let completed = false;
      setTimeout(() => { completed = true; }, 10);
      await clock.until(() => completed, 'native_task_did_not_run');
      expect(performance.now()).toBe(0);
    } finally { clock.restore(); }
    expect(performance.now).toBe(original);
  });
});
