import { expect, it } from 'vitest';
import { describeScheduledTaskNotice } from './describeScheduledTaskNotice';

const task = { task_id: 'task', task_name: '每日行业新闻', conversation_id: 'conversation' } as const;

it('标题是任务名，正文写结果', () => {
  expect(describeScheduledTaskNotice({ kind: 'completed', ...task }, true))
    .toEqual({ title: '每日行业新闻', body: '已完成，点击查看结果' });
  expect(describeScheduledTaskNotice({ kind: 'failed', ...task, reason: 'run_failed' }, true).body).toBe('没有完成，点击查看原因');
  expect(describeScheduledTaskNotice({ kind: 'awaiting_approval', ...task }, true).body).toBe('等你批准命令');
  expect(describeScheduledTaskNotice({ kind: 'awaiting_approval', ...task, interrupted: true }, true).body)
    .toBe('应用重启后批准已失效，点击查看');
  expect(describeScheduledTaskNotice({ kind: 'auto_paused', task_id: 'task', task_name: 'Brief', cause: 'unviewed' }, false))
    .toEqual({ title: 'Brief', body: 'Paused because results went unread for 14 days' });
});

it('补跑汇总没有单个任务名', () => {
  expect(describeScheduledTaskNotice({ kind: 'catch_up', task_count: 3 }, true))
    .toEqual({ title: '正在补跑定时任务', body: '3 个错过的任务' });
});
