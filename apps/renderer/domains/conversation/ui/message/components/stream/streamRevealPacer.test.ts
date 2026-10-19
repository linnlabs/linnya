import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STREAM_REVEAL_PACER_CONFIG,
  clampToCodePointBoundary,
  createStreamRevealPacer,
} from './streamRevealPacer';

/** 以 16ms 一帧推进到 untilMs，返回每帧的已放出长度。 */
function run(pacer: ReturnType<typeof createStreamRevealPacer>, fromMs: number, untilMs: number): number[] {
  const shown: number[] = [];
  for (let now = fromMs; now <= untilMs; now += 16) shown.push(pacer.advance(now));
  return shown;
}

describe('createStreamRevealPacer', () => {
  it('没有积压时什么都不放，也不会超过已收到的长度', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(10, 0);
    expect(pacer.advance(16)).toBe(10);
    pacer.receive(13, 20);
    const frames = run(pacer, 32, 400);
    expect(Math.max(...frames)).toBe(13);
    expect(pacer.shown).toBe(13);
  });

  it('突发到达：整批在落后上限内放完，且按近似匀速放出而不是先快后慢', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    pacer.receive(60, 0);
    pacer.advance(0);
    const frames = run(pacer, 16, 400);
    const doneAt = frames.findIndex(value => value === 60);
    expect(doneAt).toBeGreaterThanOrEqual(0);
    expect((doneAt + 1) * 16).toBeLessThanOrEqual(DEFAULT_STREAM_REVEAL_PACER_CONFIG.lagCapSeconds * 1000 + 32);
    const steps = frames.slice(0, doneAt + 1).map((value, index) => value - (frames[index - 1] ?? 0));
    expect(Math.max(...steps)).toBeLessThanOrEqual(Math.ceil(Math.min(...steps.filter(step => step > 0)) * 3));
  });

  it('多批连续突发：每一批的每个字都不晚于到达后落后上限加一帧', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    const arrivals: Array<{ at: number; end: number }> = [];
    let received = 0;
    const reachedAt = new Map<number, number>();
    for (let now = 0; now <= 3000; now += 16) {
      if (now % 112 === 0 && now <= 1500) {
        received += 25;
        arrivals.push({ at: now, end: received });
        pacer.receive(received, now);
      }
      const shown = pacer.advance(now);
      for (const batch of arrivals) if (shown >= batch.end && !reachedAt.has(batch.end)) reachedAt.set(batch.end, now);
    }
    for (const batch of arrivals) {
      expect(reachedAt.get(batch.end)).toBeDefined();
      expect(reachedAt.get(batch.end)! - batch.at).toBeLessThanOrEqual(250 + 32);
    }
  });

  it('来源稳定偏慢：放字速度贴着到达速度，缓冲始终很浅', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    let received = 0;
    let maxBacklog = 0;
    for (let now = 0; now <= 4000; now += 16) {
      if (now % 160 === 0) {
        received += 2; // 约 12.5 字/秒
        pacer.receive(received, now);
      }
      pacer.advance(now);
      maxBacklog = Math.max(maxBacklog, pacer.received - pacer.shown);
    }
    expect(maxBacklog).toBeLessThanOrEqual(6);
    expect(pacer.received - pacer.shown).toBeLessThanOrEqual(4);
  });

  it('来源断流：已收到的放完后保持不动，不凭空增加', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    pacer.receive(20, 0);
    run(pacer, 0, 800);
    const settled = pacer.shown;
    expect(settled).toBe(20);
    expect(run(pacer, 816, 3000).every(value => value === settled)).toBe(true);
  });

  it('断流后再次突发同样受落后上限约束', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    pacer.receive(10, 0);
    run(pacer, 0, 600);
    pacer.receive(110, 3000);
    pacer.advance(3000);
    const frames = run(pacer, 3016, 3400);
    expect(frames[frames.length - 1]).toBe(110);
  });

  it('已经超过截止时间的内容在下一帧全部放出（例如页面被挂起很久之后恢复）', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    pacer.receive(5000, 0);
    pacer.advance(0);
    expect(pacer.advance(60_000)).toBe(5000);
  });

  it('flush 立即放出全部已收到内容；reset 重新起算', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    pacer.receive(40, 0);
    expect(pacer.flush()).toBe(40);
    expect(pacer.shown).toBe(40);
    pacer.reset(5, 100);
    expect(pacer.shown).toBe(5);
    expect(pacer.received).toBe(5);
  });

  it('收到的总长度变短（内容被替换）直接重置', () => {
    const pacer = createStreamRevealPacer();
    pacer.reset(0, 0);
    pacer.receive(30, 0);
    pacer.advance(16);
    pacer.receive(8, 32);
    expect(pacer.shown).toBe(8);
    expect(pacer.received).toBe(8);
  });
});

describe('clampToCodePointBoundary', () => {
  it('不会把代理对切成两半', () => {
    const text = 'a😀b';
    expect(clampToCodePointBoundary(text, 2)).toBe(1);
    expect(clampToCodePointBoundary(text, 3)).toBe(3);
    expect(clampToCodePointBoundary(text, 0)).toBe(0);
    expect(clampToCodePointBoundary(text, 99)).toBe(text.length);
  });
});
