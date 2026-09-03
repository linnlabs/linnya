import { describe, expect, it, vi } from 'vitest';
import type { TimelineMarker } from '../definitions/timelineMarker';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';
import { navigateToTimelineVisualTurn } from './navigateToTimelineVisualTurn';

const marker: TimelineMarker = {
  visualTurnId: conversationVisualTurnIdFromUserMessageId('user-42'),
  turnIndex: 41,
  summary: 'target',
  anchorMessageId: 'user-42',
  sortSeq: 410,
};

describe('navigateToTimelineVisualTurn', () => {
  it('scrolls directly when the target is already mounted', async () => {
    const scrollToVisualTurn = vi.fn(async () => true);
    const loadAroundTurn = vi.fn(async () => 'replaced' as const);

    await expect(navigateToTimelineVisualTurn('conversation-1', marker, {
      scrollToVisualTurn,
      loadAroundTurn,
      waitForVisualTurnMounted: async () => undefined,
    })).resolves.toBe('scrolled-mounted');
    expect(loadAroundTurn).not.toHaveBeenCalled();
  });

  it('loads around the marker anchor before scrolling an unmounted target', async () => {
    const scrollToVisualTurn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const loadAroundTurn = vi.fn(async () => 'replaced' as const);
    const waitForVisualTurnMounted = vi.fn(async () => undefined);

    await expect(navigateToTimelineVisualTurn('conversation-1', marker, {
      scrollToVisualTurn,
      loadAroundTurn,
      waitForVisualTurnMounted,
    })).resolves.toBe('loaded-and-scrolled');
    expect(loadAroundTurn).toHaveBeenCalledWith('conversation-1', 'user-42');
    expect(waitForVisualTurnMounted).toHaveBeenCalledWith('visual_turn_user-42');
    expect(scrollToVisualTurn).toHaveBeenCalledTimes(2);
  });

  it('reports a target that is still absent after loadAround', async () => {
    await expect(navigateToTimelineVisualTurn('conversation-1', marker, {
      scrollToVisualTurn: async () => false,
      loadAroundTurn: async () => 'replaced',
      waitForVisualTurnMounted: async () => undefined,
    })).rejects.toThrow('timeline visual turn was not mounted after loadAround');
  });

  it('does not wait for a target while the read model is preparing', async () => {
    const waitForVisualTurnMounted = vi.fn(async () => undefined);
    await expect(navigateToTimelineVisualTurn('conversation-1', marker, {
      scrollToVisualTurn: async () => false,
      loadAroundTurn: async () => 'preparing',
      waitForVisualTurnMounted,
    })).rejects.toThrow('timeline read model is still preparing');
    expect(waitForVisualTurnMounted).not.toHaveBeenCalled();
  });

  it('treats a superseded window request as navigation cancellation', async () => {
    const waitForVisualTurnMounted = vi.fn(async () => undefined);
    let caught: unknown;
    try {
      await navigateToTimelineVisualTurn('conversation-1', marker, {
        scrollToVisualTurn: async () => false,
        loadAroundTurn: async () => 'superseded',
        waitForVisualTurnMounted,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error('expected navigation cancellation error');
    }
    expect(caught.name).toBe('AbortError');
    expect(waitForVisualTurnMounted).not.toHaveBeenCalled();
  });
});
