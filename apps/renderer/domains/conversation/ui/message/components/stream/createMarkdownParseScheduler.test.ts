import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMarkdownParseScheduler } from './createMarkdownParseScheduler';

describe('conversation Markdown parse scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes pending content at the settled boundary without a delayed second commit', () => {
    vi.useFakeTimers();
    const parse = vi.fn();
    const scheduler = createMarkdownParseScheduler({ throttleMs: 50, parse });

    scheduler.update('final answer', 'throttled');
    scheduler.update('final answer', 'immediate');

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenLastCalledWith('final answer', 'immediate');
    vi.runAllTimers();
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit the same AST when only streaming state changes', () => {
    const parse = vi.fn();
    const scheduler = createMarkdownParseScheduler({ throttleMs: 50, parse });

    scheduler.update('stable answer', 'immediate');
    scheduler.update('stable answer', 'immediate');

    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('buffers only the latest streaming body while suspended and flushes once on resume', () => {
    vi.useFakeTimers();
    const parse = vi.fn();
    const scheduler = createMarkdownParseScheduler({ throttleMs: 50, parse });

    scheduler.setSuspended(true);
    scheduler.update('first', 'throttled');
    scheduler.update('first second', 'throttled');
    vi.advanceTimersByTime(200);

    expect(parse).not.toHaveBeenCalled();

    scheduler.setSuspended(false);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenLastCalledWith('first second', 'immediate');
  });

  it('cancels an armed throttle when width motion begins', () => {
    vi.useFakeTimers();
    const parse = vi.fn();
    const scheduler = createMarkdownParseScheduler({ throttleMs: 50, parse });

    scheduler.update('before resize', 'throttled');
    scheduler.setSuspended(true);
    scheduler.update('during resize', 'throttled');
    vi.advanceTimersByTime(200);

    expect(parse).not.toHaveBeenCalled();

    scheduler.setSuspended(false);
    vi.runAllTimers();

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenLastCalledWith('during resize', 'immediate');
  });

  it('does not flush buffered Markdown after disposal', () => {
    const parse = vi.fn();
    const scheduler = createMarkdownParseScheduler({ throttleMs: 50, parse });

    scheduler.setSuspended(true);
    scheduler.update('orphaned', 'throttled');
    scheduler.dispose();
    scheduler.setSuspended(false);

    expect(parse).not.toHaveBeenCalled();
  });
});
