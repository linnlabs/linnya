import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRendererReadyEventForTesting,
  publishRendererReady,
  subscribeRendererReady,
  type RendererReadyTarget,
} from './rendererReadyEvent';

function createReadyTarget(): RendererReadyTarget {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
}

describe('rendererReadyEvent', () => {
  beforeEach(() => {
    clearRendererReadyEventForTesting();
  });

  it('publishes renderer-ready to current subscribers', () => {
    const listener = vi.fn();
    const target = createReadyTarget();

    subscribeRendererReady(listener);

    expect(publishRendererReady(target)).toBe(1);
    expect(listener).toHaveBeenCalledWith(target);
  });

  it('replays the latest usable renderer-ready target to late subscribers', () => {
    const target = createReadyTarget();
    publishRendererReady(target);

    const listener = vi.fn();
    subscribeRendererReady(listener);

    expect(listener).toHaveBeenCalledWith(target);
  });

  it('stops notifying a listener after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRendererReady(listener);

    unsubscribe();
    expect(publishRendererReady(createReadyTarget())).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
