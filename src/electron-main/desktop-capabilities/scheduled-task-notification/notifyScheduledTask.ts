import { app, Notification } from 'electron';
import { SCHEDULED_TASKS_NOTIFY_CHANNEL, type ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { subscribeRendererReady, type RendererReadyTarget } from '../../events/rendererReadyEvent';
import { getMainWindow, revealMainWindow } from '../../window-manager';

export function createScheduledTaskDesktopNotifications() {
  let readyTarget: RendererReadyTarget | undefined;
  let pendingOpen: ScheduledTaskNotification | undefined;

  function openWhenReady(rendererJustReady = false): void {
    const contents = getMainWindow()?.webContents;
    if (!contents || contents !== readyTarget || contents.isDestroyed() || (!rendererJustReady && contents.isLoadingMainFrame()) || !pendingOpen) return;
    const event = pendingOpen;
    pendingOpen = undefined;
    contents.send(SCHEDULED_TASKS_NOTIFY_CHANNEL, event, true);
  }

  const unsubscribe = subscribeRendererReady(target => {
    readyTarget = target;
    openWhenReady(true);
  });

  return {
    notify: (event: ScheduledTaskNotification) => deliverScheduledTaskNotice(event, () => {
      // 启动补跑可能早于首个窗口。等正式 renderer-ready 后再投递点击意图。
      pendingOpen = event;
      revealMainWindow();
      openWhenReady();
    }),
    dispose: unsubscribe,
  };
}

function deliverScheduledTaskNotice(event: ScheduledTaskNotification, open: () => void): void {
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
  notice.once('click', open);
  notice.show();
}
