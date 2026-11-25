import { beforeEach, expect, it, vi } from 'vitest';
import type { ScheduledTaskNotification } from '@app/schemas/scheduled-tasks';
import { clearRendererReadyEventForTesting, publishRendererReady } from '../../events/rendererReadyEvent';
import { createScheduledTaskDesktopNotifications } from './notifyScheduledTask';

const desktop = vi.hoisted(() => ({
  mainWindow: null as null | { isFocused: () => boolean; webContents: object },
  notices: [] as Array<{ options: unknown; handlers: Map<string, (details?: { reason?: string }) => void> }>,
  reveal: vi.fn(), show: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getLocale: () => 'en' },
  Notification: class {
    static isSupported() { return true; }
    handlers = new Map<string, (details?: { reason?: string }) => void>();
    constructor(options: unknown) { desktop.notices.push({ options, handlers: this.handlers }); }
    once(event: string, handler: () => void) { this.handlers.set(event, handler); }
    on(event: string, handler: (details?: { reason?: string }) => void) { this.handlers.set(event, handler); }
    show() { desktop.show(); }
  },
}));
vi.mock('../../window-manager', () => ({ getMainWindow: () => desktop.mainWindow, revealMainWindow: desktop.reveal }));

beforeEach(() => {
  clearRendererReadyEventForTesting();
  desktop.mainWindow = null;
  desktop.notices.length = 0;
  vi.clearAllMocks();
});

it('shows in-app when focused and preserves a system notification click until Renderer is ready', () => {
  const notifications = createScheduledTaskDesktopNotifications();
  try {
    const event: ScheduledTaskNotification = { kind: 'completed', task_id: 'task', task_name: 'Brief', conversation_id: 'conversation' };
    notifications.notify(event);
    expect(desktop.show).toHaveBeenCalledOnce();
    expect(desktop.notices[0]?.options).toEqual({ title: 'Brief', body: 'Finished. Click to see the result' });
    desktop.notices[0]?.handlers.get('click')?.();
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
