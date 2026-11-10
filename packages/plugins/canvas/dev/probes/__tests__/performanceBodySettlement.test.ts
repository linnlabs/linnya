import { describe, expect, it } from 'vitest';
import { waitForCanvasPerformanceBody } from '../waitForCanvasPerformanceBody';

function fixture(onFrame: (frame: number) => void = () => undefined) {
  let frame = 0;
  const state = { stats: { failed: 0, pending: 0, running: false }, resourcesIdle: true, fadingCards: 0,
    presentationReady: true, revision: 1, receiptRevision: 1 };
  const wait = (maximumWaitMs?: number) => waitForCanvasPerformanceBody({
    now: () => frame * 16,
    async nextFrame() { frame++; onFrame(frame); },
    readSnapshot: () => ({ ...state, stats: { ...state.stats } }),
  }, maximumWaitMs);
  return { state, wait, readFrame: () => frame };
}

describe('performance body settlement across asynchronous paint and draw', () => {
  it('reports a paint failure arriving during the final two frames instead of a successful empty queue', async () => {
    const test = fixture(frame => { if (frame === 2) test.state.stats.failed = 1; });
    const result = await test.wait();
    expect(result).toMatchObject({ settled: false, ms: 32, snapshot: { stats: { failed: 1, pending: 0, running: false } } });
    expect(test.readFrame()).toBe(2);
  });

  it('waits for new demand and the current revision draw after an older receipt was initially ready', async () => {
    const test = fixture(frame => {
      if (frame === 2) {
        test.state.revision = 2; test.state.stats.pending = 1; test.state.stats.running = true;
        test.state.presentationReady = false;
      }
      if (frame === 4) { test.state.stats.pending = 0; test.state.stats.running = false; }
      // 空队列和旧版receipt不等于当前正文已draw；第五帧才接纳当前版本。
      if (frame === 5) { test.state.receiptRevision = 2; test.state.presentationReady = true; }
    });
    const result = await test.wait();
    expect(result).toMatchObject({ settled: true, ms: 112, snapshot: { revision: 2, receiptRevision: 2, presentationReady: true } });
    expect(test.readFrame()).toBe(7);
  });

  it('does not settle while late media projection and the resulting texture transition are still active', async () => {
    const test = fixture(frame => {
      if (frame === 1) test.state.resourcesIdle = false;
      if (frame === 3) { test.state.resourcesIdle = true; test.state.fadingCards = 1; }
      if (frame === 6) test.state.fadingCards = 0;
    });
    const result = await test.wait();
    expect(result).toMatchObject({ settled: true, ms: 128, snapshot: { resourcesIdle: true, fadingCards: 0 } });
    expect(test.readFrame()).toBe(8);
  });

  it('keeps the real two-frame confirmation and the existing five-second failure boundary', async () => {
    const ready = fixture();
    expect(await ready.wait()).toMatchObject({ settled: true, ms: 32 });
    const missing = fixture(); missing.state.presentationReady = false;
    const result = await missing.wait();
    expect(result).toMatchObject({ settled: false, ms: 5008, snapshot: { presentationReady: false } });
  });

  it('显式确定性等待保留同一当前正文事实，五秒后仍可等待真实就绪且不丢两帧确认', async () => {
    const test = fixture(frame => {
      if (frame === 400) { test.state.stats.pending = 0; test.state.stats.running = false; test.state.presentationReady = true; }
    });
    test.state.stats.pending = 12; test.state.stats.running = true; test.state.presentationReady = false;
    expect(await test.wait(30000)).toMatchObject({ settled: true, ms: 6432,
      snapshot: { stats: { failed: 0, pending: 0, running: false }, revision: 1, receiptRevision: 1 } });
    expect(test.readFrame()).toBe(402);
  });

  it('更长观察预算仍拒绝真实paint失败和一直未draw的正文', async () => {
    const failed = fixture(frame => { if (frame === 400) failed.state.stats.failed = 1; });
    failed.state.presentationReady = false;
    expect(await failed.wait(30000)).toMatchObject({ settled: false, ms: 6400, snapshot: { stats: { failed: 1 } } });
    const missing = fixture(); missing.state.presentationReady = false;
    expect(await missing.wait(30000)).toMatchObject({ settled: false, ms: 30000, snapshot: { presentationReady: false } });
  });
});
