import { describe, expect, it } from 'vitest';
import { createLatestRasterQueue } from '../functions/createLatestRasterQueue';

describe('latest card raster queue', () => {
  it('缩放积压时有界，并释放已完成但被新版本替代的位图', async () => {
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const disposed: number[] = [];
    const queue = createLatestRasterQueue({
      capacity: 3,
      execute: async (value: number) => { await barrier; return value; },
      disposeResult: (value) => disposed.push(value),
    });
    const first = queue.enqueue('card', 0);
    await Promise.resolve(); // 本场景验证运行中的旧版本，不只是尚未开始的排队替换。
    const replaced = queue.enqueue('card', 1);
    const latest = queue.enqueue('card', 2);
    const other = Array.from({ length: 20 }, (_, i) => queue.enqueue(`other-${i}`, i + 10));
    expect(queue.readStats().peakPending).toBe(3);
    release?.();
    const results = await Promise.all([first, replaced, latest, ...other]);
    expect(results[0]).toEqual({ status: 'superseded' });
    expect(results[1]).toEqual({ status: 'superseded' });
    expect(results.filter((result) => result.status === 'ready')).toHaveLength(3);
    expect(disposed).toEqual([0]);
    expect(queue.readStats()).toMatchObject({ pending: 0, running: false, completed: 3, discarded: 19 });
  });

  it('取消与光栅错误都收口每个请求，不留下挂起的等待者', async () => {
    const queue = createLatestRasterQueue<number, number>({
      execute: async (value, signal) => { await Promise.resolve(); signal.throwIfAborted(); throw new Error(String(value)); },
      disposeResult: () => undefined,
    });
    const first = queue.enqueue('first', 1);
    const pending = queue.enqueue('next', 2);
    queue.cancel('first');
    queue.cancel('next');
    expect(await first).toEqual({ status: 'cancelled' });
    expect(await pending).toEqual({ status: 'cancelled' });
    expect((await queue.enqueue('bad', 3)).status).toBe('failed');
    queue.dispose();
    expect(await queue.enqueue('disposed', 4)).toEqual({ status: 'cancelled' });
  });
  it('同一paint批次只取消旧卡结果，其余卡仍能完成', async () => {
    const batches: number[][] = [], released: number[] = [];
    let started: (() => void) | undefined, release: (() => void) | undefined;
    const executing = new Promise<void>(resolve => { started = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const queue = createLatestRasterQueue({ batchSize: 3,
      executeBatch: async (values: readonly number[]) => { batches.push([...values]); if (values.includes(3)) { started?.(); await barrier; } return values.map(value => value * 10); },
      disposeResult: value => released.push(value),
    });
    const first = queue.enqueue('c0', 0); await Promise.resolve();
    const one = queue.enqueue('c1', 1), removed = queue.enqueue('c2', 2), stale = queue.enqueue('c3', 3), four = queue.enqueue('c4', 4);
    queue.cancel('c2'); await first; await executing; queue.cancel('c3'); release?.();
    const results = await Promise.all([one, removed, stale, four]);
    expect(batches).toEqual([[0], [1, 3, 4]]);
    expect(results).toEqual([{ status: 'ready', value: 10 }, { status: 'cancelled' }, { status: 'cancelled' }, { status: 'ready', value: 40 }]);
    expect(released).toEqual([30]); queue.dispose();
  });
  it('移动时缩小批次并按当前视口优先级重排待办，不取消同批其他结果', async () => {
    const batches: number[][] = [];
    let moving = true;
    const queue = createLatestRasterQueue({ batchSize: 4, readBatchSize: () => moving ? 2 : 4,
      executeBatch: async (values: readonly number[]) => { batches.push([...values]); moving = false; return values; }, disposeResult() {} });
    const results = Array.from({ length: 6 }, (_, i) => queue.enqueue(`c${i}`, i));
    queue.prioritize(['c5', 'c4', 'c3', 'c2', 'c1', 'c0']);
    expect(await Promise.all(results)).toEqual(Array.from({ length: 6 }, (_, i) => ({ status: 'ready', value: i })));
    expect(batches).toEqual([[5, 4], [3, 2, 1, 0]]); queue.dispose();
  });
});
