import { describe, expect, it } from 'vitest';
import type { ConversationActivity } from '@app/schemas';
import {
  resolveConversationRunStatus,
  retainSeenRunIds,
  summarizeConversationRunStatuses,
} from './resolveConversationRunStatus';

function activity(state: ConversationActivity['state'], runId = 'run-1', updatedAt = 100): ConversationActivity {
  return { state, source: 'run_registry', run_id: runId, run_status: null, reason: null, updated_at: updatedAt,
    pause: null, pending_approval_count: state === 'unavailable' ? null : 0 };
}

const fresh = { baselineAt: 50, seenRunIds: {} };

describe('resolveConversationRunStatus', () => {
  it('Host 五态映射为侧栏记号，审批读不到按进行中', () => {
    expect(resolveConversationRunStatus('c', activity('running'), fresh)).toBe('running');
    expect(resolveConversationRunStatus('c', activity('unavailable'), fresh)).toBe('running');
    expect(resolveConversationRunStatus('c', activity('awaiting_answer'), fresh)).toBe('awaiting-answer');
    expect(resolveConversationRunStatus('c', activity('awaiting_approval'), fresh)).toBe('awaiting-approval');
    expect(resolveConversationRunStatus('c', activity('interrupted'), fresh)).toBe('interrupted');
    expect(resolveConversationRunStatus('c', activity('idle'), fresh)).toBeNull();
    expect(resolveConversationRunStatus('c', undefined, fresh)).toBeNull();
  });

  it('看过同一次运行或早于基线的中断不再显示，新运行的中断重新出现', () => {
    expect(resolveConversationRunStatus('c', activity('interrupted', 'run-1'), { baselineAt: 50, seenRunIds: { c: 'run-1' } })).toBeNull();
    expect(resolveConversationRunStatus('c', activity('interrupted', 'run-2'), { baselineAt: 50, seenRunIds: { c: 'run-1' } })).toBe('interrupted');
    expect(resolveConversationRunStatus('c', activity('interrupted', 'run-1', 40), fresh)).toBeNull();
  });
});

describe('summarizeConversationRunStatuses', () => {
  it('按审批、回答、中断、进行中的优先级取一种并计数', () => {
    expect(summarizeConversationRunStatuses(['running', 'awaiting-approval', null, 'awaiting-approval', 'interrupted']))
      .toEqual({ status: 'awaiting-approval', count: 2 });
    expect(summarizeConversationRunStatuses(['running', 'interrupted'])).toEqual({ status: 'interrupted', count: 1 });
    expect(summarizeConversationRunStatuses([null])).toBeNull();
  });
});

describe('retainSeenRunIds', () => {
  it('只保留当前运行仍是记下那次的条目', () => {
    const activities = new Map([['same', activity('running', 'r1')], ['newer', activity('running', 'r3')]]);
    expect(retainSeenRunIds({ same: 'r1', newer: 'r2', idle: 'r4' }, activities)).toEqual({ same: 'r1' });
  });
});
