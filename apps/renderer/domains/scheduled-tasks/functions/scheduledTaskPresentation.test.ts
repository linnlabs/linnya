import { describe, expect, it } from 'vitest';
import type { ScheduledTask, ScheduledTaskRun } from '@app/schemas/scheduled-tasks';
import { SCHEDULED_TASK_MESSAGE_FALLBACKS } from '../definitions/scheduledTaskMessageCatalog';
import type { ScheduledTaskMessageResolver } from '../definitions/scheduledTaskMessages';
import { formatScheduledDate } from '@app/schemas';
import { describeSchedule } from './describeSchedule';
import { createScheduleDraft, scheduleFromDraft, toggleWeekday } from './scheduleDraft';
import { groupTasksByProject, presentRun, presentTaskState, resolveTaskBanner } from './presentScheduledTask';

const message: ScheduledTaskMessageResolver = (key, params) =>
  SCHEDULED_TASK_MESSAGE_FALLBACKS[key].replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? ''));

// 2026-11-23 周一 10:00（本地时间）
const now = new Date(2026, 10, 23, 10, 0);
const zhDate = (ms: number) => formatScheduledDate(ms, { locale: 'zh-CN', now });

function run(overrides: Partial<ScheduledTaskRun>): ScheduledTaskRun {
  return {
    id: 'r1', task_id: 't1', planned_at: now.getTime(), trigger: 'schedule', status: 'completed', reason: null,
    skipped_count: 1, started_at: now.getTime(), ended_at: now.getTime() + 3 * 60_000, conversation_id: 'c1',
    run_id: 'run1', permission_level: 'standard', model_config_id: null, total_tokens: 12_000, unread: false,
    ...overrides,
  };
}

describe('时间表描述', () => {
  it('七种方式各一句', () => {
    expect(describeSchedule({ kind: 'weekdays', time: '09:00' }, message, zhDate)).toBe('每个工作日 09:00');
    expect(describeSchedule({ kind: 'weekly', weekdays: [5, 1], time: '10:00' }, message, zhDate)).toBe('每周一、五 10:00');
    expect(describeSchedule({ kind: 'hourly', every_hours: 1, minute: 15 }, message, zhDate)).toBe('每小时第 15 分钟');
    expect(describeSchedule({ kind: 'hourly', every_hours: 6, minute: 0 }, message, zhDate)).toBe('每 6 小时，在第 0 分钟');
    expect(describeSchedule({ kind: 'monthly', day: 'last', time: '18:30' }, message, zhDate)).toBe('每月最后一天 18:30');
    expect(describeSchedule({ kind: 'once', date: '2026-11-30', time: '09:00' }, message, zhDate)).toBe('11月30日 09:00 运行一次');
    expect(describeSchedule({ kind: 'once', date: '2027-01-03', time: '09:00' }, message, zhDate)).toBe('2027年1月3日 09:00 运行一次');
    expect(describeSchedule({ kind: 'cron', expression: '0 9 * * 1-5' }, message, zhDate)).toBe('自定义：0 9 * * 1-5');
  });
});

describe('表单草稿', () => {
  it('新任务默认工作日 9 点，一次性默认明天', () => {
    const draft = createScheduleDraft(null, now);
    expect(scheduleFromDraft(draft)).toEqual({ kind: 'weekdays', time: '09:00' });
    expect(scheduleFromDraft({ ...draft, kind: 'once' })).toEqual({ kind: 'once', date: '2026-11-24', time: '09:00' });
    expect(draft.weekdays).toEqual([1]);
  });

  it('切换方式不丢别的字段，保存只取当前方式', () => {
    const draft = createScheduleDraft({ kind: 'monthly', day: 15, time: '08:30' }, now);
    expect(scheduleFromDraft({ ...draft, kind: 'daily' })).toEqual({ kind: 'daily', time: '08:30' });
    expect(scheduleFromDraft(draft)).toEqual({ kind: 'monthly', day: 15, time: '08:30' });
    expect(scheduleFromDraft({ ...draft, kind: 'cron', expression: ' 0  9 * *  1-5 ' }))
      .toEqual({ kind: 'cron', expression: '0 9 * * 1-5' });
  });

  it('星期至少留一天', () => {
    expect(toggleWeekday([1], 1)).toEqual([1]);
    expect(toggleWeekday([1], 5)).toEqual([1, 5]);
    expect(toggleWeekday([1, 5], 1)).toEqual([5]);
  });
});

describe('状态与运行记录', () => {
  it('启用任务显示下次时间；等审批给去处理', () => {
    expect(presentTaskState({ state: 'scheduled' }, message, '明天 9:00')).toEqual({ text: '下次 明天 9:00', tone: 'neutral' });
    const banner = resolveTaskBanner({ state: 'awaiting_approval', model_unavailable: false, consecutive_failures: 0 }, message);
    expect(banner?.action?.kind).toBe('open_approval');
    expect(resolveTaskBanner({ state: 'scheduled', model_unavailable: true, consecutive_failures: 0 }, message)?.action?.kind)
      .toBe('edit');
    expect(resolveTaskBanner({ state: 'scheduled', model_unavailable: false, consecutive_failures: 0 }, message)).toBeNull();
  });

  it('完成写用时，排队写等了多久，跳过写原因与次数', () => {
    expect(presentRun(run({}), message).detail).toBe('用时 3 分钟');
    expect(presentRun(run({ started_at: now.getTime() + 7 * 60_000, ended_at: now.getTime() + 9 * 60_000 }), message).detail)
      .toBe('名额已满，排队 7 分钟');
    const skipped = presentRun(run({ status: 'skipped', reason: 'app_not_running', skipped_count: 3, started_at: null, ended_at: null }), message);
    expect(skipped).toEqual({ statusText: '跳过', tone: 'muted', detail: 'App 没有打开，共 3 次', triggerText: null });
    expect(presentRun(run({ trigger: 'manual' }), message).triggerText).toBe('手动运行');
  });

  it('当前项目在前，其他项目按名称排', () => {
    const task = (id: string, projectId: string) => ({ id, project_id: projectId }) as ScheduledTask;
    const names: Record<string, string> = { a: '市场研究', b: '个人事务', c: '团队运营' };
    const grouped = groupTasksByProject([task('1', 'c'), task('2', 'a'), task('3', 'b'), task('4', 'gone')], 'a', id => names[id] ?? null, 'zh-CN');
    expect(grouped.current?.tasks.map(item => item.id)).toEqual(['2']);
    expect(grouped.others.map(group => group.projectId)).toEqual(['b', 'c', 'gone']);
  });
});
