import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScheduledTasksListResult } from '@app/schemas/scheduled-tasks';
import { useScheduledTasksStore } from '../scheduledTasksStore';

function list(overrides: Partial<ScheduledTasksListResult> = {}): ScheduledTasksListResult {
  return { tasks: [], settings: { max_concurrent_runs: 5 }, running_count: 0, scheduler_enabled: true, ...overrides };
}

describe('定时任务列表快照', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('App Server 报告时钟异常时记下读数；时间恢复后的下一次列表不带异常，横幅随之消失', () => {
    const store = useScheduledTasksStore();
    store.applyList(list());
    expect(store.clockAnomaly).toBeNull();
    const anomaly = { now: Date.UTC(1997, 0, 1), expected_after: Date.UTC(2026, 10, 1) };
    store.applyList(list({ clock_anomaly: anomaly }));
    expect(store.clockAnomaly).toEqual(anomaly);
    store.applyList(list());
    expect(store.clockAnomaly).toBeNull();
  });
});
