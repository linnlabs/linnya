import { describe, expect, it } from 'vitest';
import { APP_SERVER_CRASH_WINDOW_MS, recordAppServerCrash } from './recordAppServerCrash';

describe('recordAppServerCrash', () => {
  it('5 分钟内前两次自动重启，第三次交给用户', () => {
    const first = recordAppServerCrash([], 1_000);
    expect(first.action).toBe('relaunch');
    const second = recordAppServerCrash(first.history, 2_000);
    expect(second.action).toBe('relaunch');
    const third = recordAppServerCrash(second.history, 3_000);
    expect(third).toEqual({ history: [1_000, 2_000, 3_000], action: 'stop' });
  });

  it('窗口外的旧记录不计入', () => {
    const now = APP_SERVER_CRASH_WINDOW_MS + 10_000;
    expect(recordAppServerCrash([1_000, 2_000], now)).toEqual({ history: [now], action: 'relaunch' });
  });

  it('忽略来自未来或损坏的时间戳', () => {
    expect(recordAppServerCrash([Number.NaN, 9_999_999], 5_000)).toEqual({ history: [5_000], action: 'relaunch' });
  });
});
