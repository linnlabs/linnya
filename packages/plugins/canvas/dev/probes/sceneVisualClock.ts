/** 只固定视觉夹具的动画进度；timer、RAF、Pixi和GPU仍真实运行。 */
export function createSceneVisualClock() {
  const realNow = performance.now.bind(performance);
  const previous = Object.getOwnPropertyDescriptor(performance, 'now');
  let current = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => current });
  return {
    now: () => current,
    advance(milliseconds: number) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('scene_visual_clock_must_advance_monotonically');
      current += milliseconds;
    },
    async until(condition: () => boolean, failure: string) {
      const started = realNow();
      while (!condition()) {
        if (realNow() - started >= 5000) throw new Error(failure);
        // 等待真实生产timer及主画布draw，不把capture或两个RAF当作动画脉冲。
        await new Promise<void>(resolve => setTimeout(resolve, 8));
      }
    },
    restore() {
      if (previous) Object.defineProperty(performance, 'now', previous);
      else Reflect.deleteProperty(performance, 'now');
    },
  };
}

export type SceneVisualClock = ReturnType<typeof createSceneVisualClock>;
