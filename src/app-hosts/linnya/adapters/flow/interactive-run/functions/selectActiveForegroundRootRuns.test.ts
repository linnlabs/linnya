import { describe, expect, it } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

import { selectActiveForegroundRootRuns } from './selectActiveForegroundRootRuns';

type RunSnapshot = runSupervisor.RunSnapshot;

function run(id: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: RunIdSchema.parse(id),
    conversationId: 'conversation-a',
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    metadata: { lane: 'foreground' },
    ...overrides,
  };
}

describe('selectActiveForegroundRootRuns', () => {
  it('排除 child、auxiliary、awaiting_user 与 paused，并按对话聚合', () => {
    const groups = selectActiveForegroundRootRuns([
      run('root-b', { conversationId: 'conversation-b', startedAt: 5 }),
      run('root-a', { startedAt: 3 }),
      run('root-a', { startedAt: 3 }),
      run('root-a-2', { status: 'pending', startedAt: 4 }),
      run('child-a', { parentRunId: RunIdSchema.parse('root-a') }),
      run('title-a', { metadata: { lane: 'auxiliary' } }),
      run('no-lane', { conversationId: 'conversation-c', metadata: {} }),
      run('wait', { conversationId: 'conversation-d', status: 'awaiting_user' }),
      run('paused', { conversationId: 'conversation-e', status: 'paused' }),
    ]);

    expect(groups.map(group => ({
      conversationId: group.conversationId,
      runIds: group.runs.map(item => item.runId),
    }))).toEqual([
      { conversationId: 'conversation-a', runIds: ['root-a', 'root-a-2'] },
      { conversationId: 'conversation-b', runIds: ['root-b'] },
    ]);
  });
});
