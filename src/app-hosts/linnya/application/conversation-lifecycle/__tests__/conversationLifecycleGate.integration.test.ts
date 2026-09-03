import { describe, expect, it } from 'vitest';

import { deriveConversationWorkDirectoryIdentity } from '../../../../../domains/conversation-files';
import { createConversationLifecycleGate } from '../orchestration/createConversationLifecycleGate';

function createBlocker(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('conversation lifecycle gate', () => {
  it('同一对话按提交顺序串行，不同对话可以并发', async () => {
    const gate = createConversationLifecycleGate();
    const firstIdentity = deriveConversationWorkDirectoryIdentity('gate-conversation-a');
    const secondIdentity = deriveConversationWorkDirectoryIdentity('gate-conversation-b');
    const blocker = createBlocker();
    const events: string[] = [];

    const first = gate.runExclusive({
      scope: {
        conversationId: firstIdentity.conversationId,
        operation: 'conversation_admission',
      },
      run: async () => {
        events.push('first:start');
        await blocker.promise;
        events.push('first:end');
      },
    });
    const queued = gate.runExclusive({
      scope: {
        conversationId: firstIdentity.conversationId,
        operation: 'directory_cleanup_job',
      },
      run: () => {
        events.push('queued:start');
      },
    });
    const parallel = gate.runExclusive({
      scope: {
        conversationId: secondIdentity.conversationId,
        operation: 'directory_cleanup_job',
      },
      run: () => {
        events.push('parallel:start');
      },
    });

    await parallel;
    expect(events).toEqual(['first:start', 'parallel:start']);
    blocker.release();
    await Promise.all([first, queued]);
    expect(events).toEqual([
      'first:start',
      'parallel:start',
      'first:end',
      'queued:start',
    ]);
  });

  it('首项异步失败后仍按提交顺序执行后续两项', async () => {
    const gate = createConversationLifecycleGate();
    const identity = deriveConversationWorkDirectoryIdentity('gate-failure-release');
    const events: string[] = [];
    const first = gate.runExclusive({
      scope: {
        conversationId: identity.conversationId,
        operation: 'conversation_admission',
      },
      run: async () => {
        events.push('first');
        await Promise.resolve();
        throw new Error('admission_failed');
      },
    });
    const second = gate.runExclusive({
      scope: {
        conversationId: identity.conversationId,
        operation: 'directory_cleanup_job',
      },
      run: async () => {
        await Promise.resolve();
        events.push('second');
        return 'continued';
      },
    });
    const third = gate.runExclusive({
      scope: {
        conversationId: identity.conversationId,
        operation: 'conversation_admission',
      },
      run: () => {
        events.push('third');
        return 'completed';
      },
    });

    await expect(first).rejects.toThrow('admission_failed');
    await expect(second).resolves.toBe('continued');
    await expect(third).resolves.toBe('completed');
    expect(events).toEqual(['first', 'second', 'third']);
  });
});
