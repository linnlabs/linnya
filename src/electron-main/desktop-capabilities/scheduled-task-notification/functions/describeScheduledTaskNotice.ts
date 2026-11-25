import type { ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';

export interface ScheduledTaskNoticeText {
  readonly title: string;
  readonly body: string;
}

/** 系统通知的文案：标题是任务名，正文只写结果。应用名由系统显示。 */
export function describeScheduledTaskNotice(event: ScheduledTaskNotification, chinese: boolean): ScheduledTaskNoticeText {
  const text = (zh: string, en: string): string => (chinese ? zh : en);
  switch (event.kind) {
    case 'completed':
      return { title: event.task_name, body: text('已完成，点击查看结果', 'Finished. Click to see the result') };
    case 'awaiting_approval':
      return {
        title: event.task_name,
        body: event.interrupted
          ? text('应用重启后批准已失效，点击查看', 'The approval expired after a restart. Click to review')
          : text('等你批准命令', 'Waiting for you to approve a command'),
      };
    case 'failed':
      return { title: event.task_name, body: text('没有完成，点击查看原因', 'Did not finish. Click to see why') };
    case 'auto_paused':
      return {
        title: event.task_name,
        body: event.cause === 'failures'
          ? text('连续失败，已自动暂停', 'Paused after several failures in a row')
          : text('14 天没有看过结果，已自动暂停', 'Paused because results went unread for 14 days'),
      };
    case 'catch_up':
      return {
        title: text('正在补跑定时任务', 'Catching up on scheduled tasks'),
        body: text(`${event.task_count} 个错过的任务`, `${event.task_count} missed tasks`),
      };
  }
}
