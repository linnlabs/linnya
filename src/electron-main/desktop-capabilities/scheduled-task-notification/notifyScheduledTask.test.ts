import { beforeEach, expect, it, vi } from 'vitest';
import type { ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { clearRendererReadyEventForTesting, publishRendererReady } from '../../events/rendererReadyEvent';
import { createScheduledTaskDesktopNotifications } from './notifyScheduledTask';

const desktop = vi.hoisted(() => ({
  mainWindow: null as null | { isFocused: () => boolean; webContents: object },
  clicks: [] as Array<() => void>,
  reveal: vi.fn(), show: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getLocale: () => 'en' },
  Notification: class {
    static isSupported() { return true; }
    once(event: string, click: () => void) { if (event === 'click') desktop.clicks.push(click); }
    show() { desktop.show(); }
  },
}));
vi.mock('../../window-manager', () => ({ getMainWindow: () => desktop.mainWindow, revealMainWindow: desktop.reveal }));

beforeEach(() => {
  clearRendererReadyEventForTesting();
  desktop.mainWindow = null;
  desktop.clicks.length = 0;
  vi.clearAllMocks();
});

it('shows in-app when focused and preserves a system notification click until Renderer is ready', () => {
  const notifications = createScheduledTaskDesktopNotifications();
  try {
    const event: ScheduledTaskNotification = { kind: 'completed', task_id: 'task', task_name: 'Brief', conversation_id: 'conversation' };
    notifications.notify(event);
    expect(desktop.show).toHaveBeenCalledOnce();
    desktop.clicks[0]?.();
    expect(desktop.reveal).toHaveBeenCalledOnce();
    const contents = { send: vi.fn(), isDestroyed: () => false, isLoadingMainFrame: () => false };
    desktop.mainWindow = { isFocused: () => true, webContents: contents };
    publishRendererReady(contents);
    expect(contents.send).toHaveBeenLastCalledWith('scheduled-tasks:notify', event, true);
    notifications.notify(event);
    expect(contents.send).toHaveBeenLastCalledWith('scheduled-tasks:notify', event);
    expect(desktop.show).toHaveBeenCalledOnce();
  } finally { notifications.dispose(); }
});
