// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, ScheduledTaskRun, ScheduledTasksListResult } from '@app/schemas/scheduled-tasks';

const mocks = vi.hoisted(() => ({
  reloadProjectScopes: vi.fn(),
  markViewed: vi.fn(),
}));

vi.mock('@/domains/conversation/history/list', () => ({
  useHistoryList: () => ({ reloadProjectScopes: mocks.reloadProjectScopes }),
}));

vi.mock('@/domains/scheduled-tasks', async () => {
  const { useScheduledTasksStore } = await import('@/domains/scheduled-tasks/store/scheduledTasksStore');
  return {
    useScheduledTasksStore,
    scheduledTasksClient: { markViewed: mocks.markViewed },
  };
});

import { useConversationState } from '@/domains/conversation/store/conversationState';
import { useScheduledTasksStore } from '@/domains/scheduled-tasks/store/scheduledTasksStore';
import { startScheduledConversationHistorySync } from '../startScheduledConversationHistorySync';
import { startScheduledConversationViewedReporting } from '../startScheduledConversationViewedReporting';

const NOW = Date.UTC(2026, 10, 23, 2, 0);

function run(overrides: Partial<ScheduledTaskRun> = {}): ScheduledTaskRun {
  return {
    id: 'r1', task_id: 't1', planned_at: NOW, trigger: 'manual', status: 'completed', reason: null,
    skipped_count: 1, started_at: NOW, ended_at: NOW + 1000, conversation_id: 'c1', run_id: 'run1',
    permission_level: 'standard', model_config_id: null, total_tokens: 10, unread: true,
    ...overrides,
  };
}

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 't1', project_id: 'p1', name: '每日新闻', prompt: '搜集新闻', agent: 'default', model_config_id: null,
    model_unavailable: false, schedule: { kind: 'weekdays', time: '09:00' }, missed_policy: 'run_latest',
    permission_level: 'standard', state: 'scheduled', next_run_at: NOW + 3_600_000, last_run: null,
    consecutive_failures: 0, unread_count: 0, run_count: 0, storage_bytes: null,
    source: { kind: 'user' }, created_at: NOW, updated_at: NOW, revision: 0,
    ...overrides,
  } as ScheduledTask;
}

function list(tasks: ScheduledTask[]): ScheduledTasksListResult {
  return {
    tasks,
    settings: { max_concurrent_runs: 5 },
    running_count: 0,
    scheduler_enabled: true,
  } as ScheduledTasksListResult;
}

describe('定时对话与侧栏、已看上报', () => {
  const stops: (() => void)[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    mocks.reloadProjectScopes.mockReset();
    mocks.markViewed.mockReset().mockResolvedValue(undefined);
    (window as unknown as { electronAPI: unknown }).electronAPI = { scheduledTasks: {} };
  });

  afterEach(() => {
    stops.splice(0).forEach(stop => stop());
    vi.useRealTimers();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('首次读到的现状不重读；折叠字段变化合并成一次重读，只重读涉及的项目', async () => {
    const store = useScheduledTasksStore();
    stops.push(startScheduledConversationHistorySync());
    store.applyList(list([task(), task({ id: 't2', project_id: 'p2' })]));
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(mocks.reloadProjectScopes).not.toHaveBeenCalled();

    // 开跑、跑完、未读 +1：连着几次推送。
    store.applyTask(task({ last_run: run({ status: 'running', unread: false }), run_count: 1 }));
    await nextTick();
    store.applyTask(task({ last_run: run(), run_count: 1, unread_count: 1 }));
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(mocks.reloadProjectScopes).toHaveBeenCalledTimes(1);
    expect(mocks.reloadProjectScopes).toHaveBeenCalledWith(['p1']);

    // 与折叠行无关的字段（下次运行时间）不触发。
    store.applyTask(task({ last_run: run(), run_count: 1, unread_count: 1, next_run_at: NOW + 7_200_000 }));
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(mocks.reloadProjectScopes).toHaveBeenCalledTimes(1);

    // 删除任务：它的项目也要重读，折叠行要消失。
    store.removeTask('t2');
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(mocks.reloadProjectScopes).toHaveBeenLastCalledWith(['p2']);
  });

  it('切换对话就上报；正开着的对话里定时运行跑完，按运行补报一次', async () => {
    const store = useScheduledTasksStore();
    const conversation = useConversationState();
    stops.push(startScheduledConversationViewedReporting());

    conversation.activeConversationId = 'c-old';
    await nextTick();
    expect(mocks.markViewed).toHaveBeenCalledWith('c-old');
    mocks.markViewed.mockClear();

    // 任务还有更早的未读，这次运行正在跑：不能提前报（报了跑完就不会再报）。
    conversation.activeConversationId = 'c1';
    await nextTick();
    mocks.markViewed.mockClear();
    store.applyList(list([task({ unread_count: 1, last_run: run({ status: 'running', unread: false }) })]));
    await nextTick();
    expect(mocks.markViewed).not.toHaveBeenCalled();

    store.applyTask(task({ unread_count: 2, last_run: run() }));
    await nextTick();
    expect(mocks.markViewed).toHaveBeenCalledTimes(1);
    expect(mocks.markViewed).toHaveBeenCalledWith('c1');

    // App Server 记为已看后推送变化：不再来回上报。
    store.applyTask(task({ unread_count: 1, last_run: run({ unread: false }) }));
    await nextTick();
    store.applyTask(task({ unread_count: 1, last_run: run(), revision: 1 }));
    await nextTick();
    expect(mocks.markViewed).toHaveBeenCalledTimes(1);
  });
});
