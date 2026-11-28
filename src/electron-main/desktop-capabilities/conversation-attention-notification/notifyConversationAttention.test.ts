import { beforeEach, expect, it, vi } from 'vitest';
import type { ConversationAttentionNotification } from '@app/schemas';
import { clearRendererReadyEventForTesting, publishRendererReady } from '../../events/rendererReadyEvent';
import { createConversationAttentionDesktopNotifications } from './notifyConversationAttention';

const desktop = vi.hoisted(() => ({
  locale: 'zh-CN',
  mainWindow: null as null | { isFocused: () => boolean; webContents: object },
  notices: [] as Array<{ options: unknown; handlers: Map<string, (details?: { reason?: string }) => void> }>,
  reveal: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getLocale: () => desktop.locale },
  Notification: class {
    static isSupported() { return true; }
    handlers = new Map<string, (details?: { reason?: string }) => void>();
    constructor(options: unknown) { desktop.notices.push({ options, handlers: this.handlers }); }
    once(event: string, handler: () => void) { this.handlers.set(event, handler); }
    on(event: string, handler: (details?: { reason?: string }) => void) { this.handlers.set(event, handler); }
    show() {}
  },
}));
vi.mock('../../window-manager', () => ({ getMainWindow: () => desktop.mainWindow, revealMainWindow: desktop.reveal }));

beforeEach(() => {
  clearRendererReadyEventForTesting();
  desktop.locale = 'zh-CN';
  desktop.mainWindow = null;
  desktop.notices.length = 0;
  vi.clearAllMocks();
});

const waiting = (overrides: Partial<ConversationAttentionNotification> = {}): ConversationAttentionNotification => ({
  kind: 'awaiting_approval', conversation_id: 'conversation-1', project_id: 'project-1',
  conversation_title: '发布方案', sender: { entry: 'linnya_cli', name: 'Codex' }, ...overrides,
});

it('窗口不在前台时发系统通知：标题是对话名，正文说在等什么、谁发起的；点通知拉起窗口并让界面打开那段对话', () => {
  const notifications = createConversationAttentionDesktopNotifications();
  try {
    const event = waiting();
    notifications.notify(event);
    notifications.notify(waiting({ kind: 'awaiting_answer', conversation_title: null, sender: { entry: 'linnya_cli' } }));
    desktop.locale = 'en-US';
    notifications.notify(event);
    expect(desktop.notices.map(notice => notice.options)).toEqual([
      { title: '发布方案', body: '等你批准命令（Codex 发起）' },
      // 调用方没报名称时用入口名。
      { title: '未命名对话', body: '等你回答（Linnya CLI 发起）' },
      { title: '发布方案', body: 'Waiting for you to approve a command (started by Codex)' },
    ]);

    desktop.notices[0]?.handlers.get('click')?.();
    expect(desktop.reveal).toHaveBeenCalledOnce();
    const contents = { send: vi.fn(), isDestroyed: () => false, isLoadingMainFrame: () => false };
    desktop.mainWindow = { isFocused: () => true, webContents: contents };
    publishRendererReady(contents);
    expect(contents.send).toHaveBeenLastCalledWith('conversation-attention:notify', event, true);

    // 窗口在前台：不打扰系统通知，交给界面做应用内提示。
    notifications.notify(event);
    expect(contents.send).toHaveBeenLastCalledWith('conversation-attention:notify', event);
    expect(desktop.notices).toHaveLength(3);
  } finally { notifications.dispose(); }
});
