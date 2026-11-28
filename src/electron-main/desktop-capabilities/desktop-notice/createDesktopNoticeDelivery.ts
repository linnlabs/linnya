import { app, Notification } from 'electron';
import { subscribeRendererReady, type RendererReadyTarget } from '../../events/rendererReadyEvent';
import { getMainWindow, revealMainWindow } from '../../window-manager';
import { holdNotice } from './functions/holdNotice';

export interface DesktopNoticeText {
  readonly title: string;
  readonly body: string;
}

/**
 * 把后台的一类提醒交给用户：窗口在前台时转给 Renderer 做应用内提示；不在前台时发系统通知，
 * 用户点通知后拉起窗口，并在 Renderer 就绪后把同一事件再发一次（第二个参数 `true` 表示要打开）。
 * 文案由各类提醒自己给；应用名由系统显示。
 */
export function createDesktopNoticeDelivery<Event>(input: {
  readonly channel: string;
  readonly describe: (event: Event, chinese: boolean) => DesktopNoticeText;
}) {
  let readyTarget: RendererReadyTarget | undefined;
  let pendingOpen: Event | undefined;
  const shownNotices = new Set<Notification>();

  // Windows 在第一次用到通知时才登记应用标识，提前登记，第一条通知才来得及弹横幅。
  if (process.platform === 'win32') Notification.isSupported();

  function openWhenReady(rendererJustReady = false): void {
    const contents = getMainWindow()?.webContents;
    if (!contents || contents !== readyTarget || contents.isDestroyed() || (!rendererJustReady && contents.isLoadingMainFrame()) || pendingOpen === undefined) return;
    const event = pendingOpen;
    pendingOpen = undefined;
    contents.send(input.channel, event, true);
  }

  const unsubscribe = subscribeRendererReady(target => {
    readyTarget = target;
    openWhenReady(true);
  });

  return {
    notify(event: Event): void {
      const window = getMainWindow();
      if (window?.isFocused()) {
        window.webContents.send(input.channel, event);
        return;
      }
      if (!Notification.isSupported()) throw new Error('System notifications are unavailable');
      const notice = new Notification(input.describe(event, app.getLocale().startsWith('zh')));
      holdNotice(shownNotices, notice);
      notice.once('click', () => {
        // 提醒可能早于首个窗口（启动补跑）。等正式 renderer-ready 后再投递点击意图。
        pendingOpen = event;
        revealMainWindow();
        openWhenReady();
      });
      notice.show();
    },
    dispose(): void {
      unsubscribe();
      shownNotices.clear();
    },
  };
}
