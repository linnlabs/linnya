// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { observeDetachedInteractiveRun } from '../orchestration/observeDetachedInteractiveRun';
import { useDetachedInteractiveRunObservation } from './useDetachedInteractiveRunObservation';

vi.mock('../orchestration/observeDetachedInteractiveRun', () => ({
  observeDetachedInteractiveRun: vi.fn(async () => undefined),
}));

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('脱离 SSE 的观察节奏', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(observeDetachedInteractiveRun).mockClear();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('每 2 秒观察一次；隐藏时关闭空闲检查，重新可见立即观察一次；销毁后不再调度', async () => {
    const scope = effectScope();
    scope.run(() => useDetachedInteractiveRunObservation(() => 'conversation-1'));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(observeDetachedInteractiveRun).toHaveBeenLastCalledWith('conversation-1', { observeIdle: true });

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(observeDetachedInteractiveRun).toHaveBeenLastCalledWith('conversation-1', { observeIdle: false });
    const callsWhileHidden = vi.mocked(observeDetachedInteractiveRun).mock.calls.length;

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(observeDetachedInteractiveRun).toHaveBeenCalledTimes(callsWhileHidden + 1);
    expect(observeDetachedInteractiveRun).toHaveBeenLastCalledWith('conversation-1', { observeIdle: true });

    scope.stop();
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observeDetachedInteractiveRun).toHaveBeenCalledTimes(callsWhileHidden + 1);
  });
});
