import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHoverPreviewSchedule } from './orchestration/createHoverPreviewSchedule';

function setup() {
  const events: string[] = [];
  const schedule = createHoverPreviewSchedule({
    prepare: () => events.push('prepare'),
    reveal: () => events.push('reveal'),
    close: () => events.push('close'),
  });
  return { events, schedule };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('停留期间先准备，内容已排好时到露出时间一次露出；扫过不准备，露出前离开立即取消', () => {
  const { events, schedule } = setup();
  schedule.enter();
  vi.advanceTimersByTime(100);
  schedule.leave();
  vi.advanceTimersByTime(1000);
  expect(events).toEqual([]);

  schedule.enter();
  vi.advanceTimersByTime(150);
  expect(events).toEqual(['prepare']);
  schedule.ready();
  vi.advanceTimersByTime(249);
  expect(events).toEqual(['prepare']);
  vi.advanceTimersByTime(1);
  expect(events).toEqual(['prepare', 'reveal']);
  schedule.close();

  events.length = 0;
  schedule.enter();
  vi.advanceTimersByTime(300);
  schedule.leave();
  expect(events).toEqual(['prepare', 'close']);
  vi.advanceTimersByTime(1000);
  expect(events).toEqual(['prepare', 'close']);
});

it('到露出时间内容没排好：宽限期内排好就带着内容露出，否则宽限用完露出占位', () => {
  const { events, schedule } = setup();
  schedule.enter();
  vi.advanceTimersByTime(450);
  expect(events).toEqual(['prepare']);
  schedule.ready();
  expect(events).toEqual(['prepare', 'reveal']);
  schedule.close();

  events.length = 0;
  schedule.enter();
  vi.advanceTimersByTime(549);
  expect(events).toEqual(['prepare']);
  vi.advanceTimersByTime(1);
  expect(events).toEqual(['prepare', 'reveal']);
  // 迟到的就绪不再重复露出。
  schedule.ready();
  expect(events).toEqual(['prepare', 'reveal']);
});

it('露出后离开延迟关闭，移进浮层或回到触发处则保留且不重新准备；键盘聚焦不等停留', () => {
  const { events, schedule } = setup();
  schedule.enter(true);
  expect(events).toEqual(['prepare']);
  schedule.ready();
  expect(events).toEqual(['prepare', 'reveal']);
  schedule.leave();
  vi.advanceTimersByTime(150);
  schedule.stay();
  vi.advanceTimersByTime(1000);
  schedule.leave();
  vi.advanceTimersByTime(150);
  schedule.enter();
  vi.advanceTimersByTime(1000);
  expect(events).toEqual(['prepare', 'reveal']);
  schedule.leave();
  vi.advanceTimersByTime(200);
  expect(events).toEqual(['prepare', 'reveal', 'close']);
});
