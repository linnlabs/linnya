import { app, Notification } from 'electron';
import { SCHEDULED_TASKS_NOTIFY_CHANNEL, type ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { subscribeRendererReady, type RendererReadyTarget } from '../../events/rendererReadyEvent';
import { getMainWindow, revealMainWindow } from '../../window-manager';
import { describeScheduledTaskNotice } from './functions/describeScheduledTaskNotice';
import { holdNotice } from './functions/holdNotice';

export function createScheduledTaskDesktopNotifications() {
  let readyTarget: RendererReadyTarget | undefined;
  let pendingOpen: ScheduledTaskNotification | undefined;
  const shownNotices = new Set<Notification>();

  // Windows 在第一次用到通知时才登记应用标识，提前登记，第一条通知才来得及弹横幅。
  if (process.platform === 'win32') Notification.isSupported();

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
    notify: (event: ScheduledTaskNotification) => deliverScheduledTaskNotice(event, shownNotices, () => {
      // 启动补跑可能早于首个窗口。等正式 renderer-ready 后再投递点击意图。
      pendingOpen = event;
      revealMainWindow();
      openWhenReady();
    }),
    dispose: () => {
      unsubscribe();
      shownNotices.clear();
    },
  };
}

function deliverScheduledTaskNotice(event: ScheduledTaskNotification, shownNotices: Set<Notification>, open: () => void): void {
  const window = getMainWindow();
  if (window?.isFocused()) {
    window.webContents.send(SCHEDULED_TASKS_NOTIFY_CHANNEL, event);
    return;
  }
  if (!Notification.isSupported()) throw new Error('System notifications are unavailable');
  const notice = new Notification(describeScheduledTaskNotice(event, app.getLocale().startsWith('zh')));
  holdNotice(shownNotices, notice);
  notice.once('click', open);
  notice.show();
}
