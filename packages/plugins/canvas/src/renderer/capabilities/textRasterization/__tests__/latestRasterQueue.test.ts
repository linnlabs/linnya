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
    const queue = createLatestRasterQueue({ batchSize: 3,
      executeBatch: async (values: readonly number[]) => { batches.push([...values]); await Promise.resolve(); return values.map(value => value * 10); },
      disposeResult: value => released.push(value),
    });
    const first = queue.enqueue('c0', 0), one = queue.enqueue('c1', 1), removed = queue.enqueue('c2', 2), stale = queue.enqueue('c3', 3), four = queue.enqueue('c4', 4);
    queue.cancel('c2'); await first; queue.cancel('c3');
    const results = await Promise.all([one, removed, stale, four]);
    expect(batches).toEqual([[0], [1, 3, 4]]);
    expect(results).toEqual([{ status: 'ready', value: 10 }, { status: 'cancelled' }, { status: 'cancelled' }, { status: 'ready', value: 40 }]);
    expect(released).toEqual([30]); queue.dispose();
  });
});
