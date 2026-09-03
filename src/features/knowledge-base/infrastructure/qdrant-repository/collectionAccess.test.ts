import { describe, expect, it } from 'vitest';

import { runWithCollectionAccess } from './collectionAccess';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('collectionAccess', () => {
  it('应允许同一 collection 的 shared 访问并发执行', async () => {
    const started: string[] = [];
    const finished: string[] = [];

    await Promise.all([
      runWithCollectionAccess('kb-shared', 'shared', async () => {
        started.push('a');
        await sleep(20);
        finished.push('a');
      }),
      runWithCollectionAccess('kb-shared', 'shared', async () => {
        started.push('b');
        await sleep(20);
        finished.push('b');
      }),
    ]);

    expect(started).toEqual(['a', 'b']);
    expect(finished.sort()).toEqual(['a', 'b']);
  });

  it('应在 exclusive 等待时阻塞后续 shared 访问', async () => {
    const events: string[] = [];

    const firstShared = runWithCollectionAccess('kb-exclusive', 'shared', async () => {
      events.push('shared-1-start');
      await sleep(30);
      events.push('shared-1-end');
    });

    await sleep(5);

    const exclusive = runWithCollectionAccess('kb-exclusive', 'exclusive', async () => {
      events.push('exclusive-start');
      await sleep(10);
      events.push('exclusive-end');
    });

    await sleep(5);

    const secondShared = runWithCollectionAccess('kb-exclusive', 'shared', async () => {
      events.push('shared-2-start');
      events.push('shared-2-end');
    });

    await Promise.all([firstShared, exclusive, secondShared]);

    expect(events).toEqual([
      'shared-1-start',
      'shared-1-end',
      'exclusive-start',
      'exclusive-end',
      'shared-2-start',
      'shared-2-end',
    ]);
  });
});
