import { app, Notification } from 'electron';
import { SCHEDULED_TASKS_NOTIFY_CHANNEL, type ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { getMainWindow, revealMainWindow } from '../../window-manager';

export function notifyScheduledTask(event: ScheduledTaskNotification): void {
  const window = getMainWindow();
  if (window?.isFocused()) {
    window.webContents.send(SCHEDULED_TASKS_NOTIFY_CHANNEL, event);
    return;
  }
  if (!Notification.isSupported()) throw new Error('System notifications are unavailable');
  const chinese = app.getLocale().startsWith('zh');
  const titles = chinese ? {
    completed: '定时任务已完成', awaiting_approval: '定时任务等待审批', failed: '定时任务失败',
    auto_paused: '定时任务已自动暂停', catch_up: '正在补跑定时任务',
  } : {
    completed: 'Scheduled task completed', awaiting_approval: 'Scheduled task needs approval', failed: 'Scheduled task failed',
    auto_paused: 'Scheduled task paused automatically', catch_up: 'Catching up on scheduled tasks',
  };
  const body = event.kind === 'catch_up' ? (chinese ? `${event.task_count} 个任务` : `${event.task_count} tasks`) : event.task_name;
  const notice = new Notification({ title: titles[event.kind], body });
  notice.once('click', () => {
    revealMainWindow();
    // 点击和前台提示共用原通知 payload，Renderer 将点击交给现有 workspace navigation。
    getMainWindow()?.webContents.send(SCHEDULED_TASKS_NOTIFY_CHANNEL, event, true);
  });
  notice.show();
}
