import { describe, expect, it, vi } from 'vitest';

import type { AppInstanceOwnershipPort } from '../definitions/appInstanceOwnership';
import { claimPrimaryAppInstance } from '../orchestration/claimPrimaryAppInstance';

function createApp(lockGranted: boolean): {
  readonly app: AppInstanceOwnershipPort;
  readonly quit: ReturnType<typeof vi.fn>;
  emitSecondInstance(): void;
} {
  let secondInstanceListener: (() => void) | undefined;
  const quit = vi.fn();
  return {
    app: {
      requestSingleInstanceLock: () => lockGranted,
      on(_event, listener) {
        secondInstanceListener = listener;
      },
      quit,
    },
    quit,
    emitSecondInstance() {
      secondInstanceListener?.();
    },
  };
}

describe('claimPrimaryAppInstance', () => {
  it('首个桌面进程持有唯一 owner，并把后续启动路由到当前窗口', () => {
    const fixture = createApp(true);
    const revealPrimaryWindow = vi.fn();

    expect(claimPrimaryAppInstance({
      app: fixture.app,
      revealPrimaryWindow,
    })).toEqual({ status: 'primary' });

    fixture.emitSecondInstance();
    expect(revealPrimaryWindow).toHaveBeenCalledOnce();
    expect(fixture.quit).not.toHaveBeenCalled();
  });

  it('第二个桌面进程在加载生产生命周期前退出', () => {
    const fixture = createApp(false);
    const revealPrimaryWindow = vi.fn();

    expect(claimPrimaryAppInstance({
      app: fixture.app,
      revealPrimaryWindow,
    })).toEqual({ status: 'secondary' });

    fixture.emitSecondInstance();
    expect(fixture.quit).toHaveBeenCalledOnce();
    expect(revealPrimaryWindow).not.toHaveBeenCalled();
  });
});
