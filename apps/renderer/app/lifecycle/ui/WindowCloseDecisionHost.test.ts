// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import {
  WindowCloseDecisionRequestMessageSchema,
  type WindowCloseDecisionRequestMessage,
  type WindowClosePrompt,
  type WindowCloseRequestId,
} from '@linnya/app-lifecycle-contract';
import { ensureWindowCloseLocalizationRegistered } from '../orchestration/ensureWindowCloseLocalizationRegistered';
import WindowCloseDecisionHost from './WindowCloseDecisionHost.vue';

const SESSION = '11111111-1111-4111-8111-111111111111';
const RUNNING: WindowClosePrompt = { kind: 'running_tasks', has_executing_commands: true, scheduled_running_count: 2 };

function createRequest(suffix: string, prompt: WindowClosePrompt): WindowCloseDecisionRequestMessage {
  return WindowCloseDecisionRequestMessageSchema.parse({
    schema_version: 1,
    kind: 'window_close_decision_request',
    renderer_session_id: SESSION,
    request_id: `22222222-2222-4222-8222-22222222222${suffix}`,
    prompt,
  });
}

describe('WindowCloseDecisionHost', () => {
  let app: App;
  let host: HTMLDivElement;
  let request: (message: WindowCloseDecisionRequestMessage) => void;
  let dismiss: (requestId: WindowCloseRequestId) => void;
  const presented = vi.fn();
  const resolved = vi.fn();

  beforeEach(() => {
    presented.mockReset();
    resolved.mockReset();
    ensureWindowCloseLocalizationRegistered();
    vi.stubGlobal('electronAPI', {
      onWindowCloseDecisionRequest: (callback: typeof request) => {
        request = callback;
        return () => {};
      },
      onWindowCloseDecisionDismiss: (callback: typeof dismiss) => {
        dismiss = callback;
        return () => {};
      },
      markWindowCloseDecisionPresented: presented,
      resolveWindowCloseDecision: resolved,
    });
    host = document.createElement('div');
    document.body.append(host);
    app = createApp(WindowCloseDecisionHost);
    app.use(createPinia());
    app.mount(host);
  });

  afterEach(() => {
    app.unmount();
    host.remove();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function settle(): Promise<void> {
    for (let index = 0; index < 4; index += 1) await nextTick();
  }

  function readDialog(): HTMLElement | null {
    const dialogs = document.body.querySelectorAll<HTMLElement>('[role="alertdialog"]');
    return dialogs[dialogs.length - 1] ?? null;
  }

  function pressButton(label: string): void {
    Array.from(readDialog()?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.trim() === label)
      ?.click();
  }

  it('弹窗画出来以后才报告，确认后交回“继续退出”', async () => {
    const message = createRequest('1', RUNNING);
    request(message);
    expect(presented).not.toHaveBeenCalled();
    await settle();

    expect(readDialog()?.textContent).toContain('退出 Linnya？');
    expect(readDialog()?.textContent).toContain('正在运行的命令会停止，2 个定时任务会中断。');
    expect(presented).toHaveBeenCalledExactlyOnceWith(message.request_id);

    pressButton('停止并退出');
    expect(resolved).toHaveBeenCalledExactlyOnceWith(message.request_id, 'proceed');
    pressButton('停止并退出');
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('直接按 Enter 或 Escape 都是返回', async () => {
    const first = createRequest('1', RUNNING);
    request(first);
    await settle();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(resolved).toHaveBeenLastCalledWith(first.request_id, 'return');

    const second = createRequest('2', RUNNING);
    request(second);
    await settle();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(resolved).toHaveBeenLastCalledWith(second.request_id, 'return');
    expect(resolved).toHaveBeenCalledTimes(2);
  });

  it('保存失败按退出和重启更新分别说明', async () => {
    request(createRequest('1', { kind: 'save_failed', intent: 'ordinary_exit' }));
    await settle();
    expect(readDialog()?.textContent).toContain('继续会丢失这些修改。');
    expect(readDialog()?.textContent).toContain('仍要退出');

    request(createRequest('2', { kind: 'save_failed', intent: 'install_update' }));
    await settle();
    expect(readDialog()?.textContent).toContain('仍要重启更新');
  });

  it('主进程改用系统框后收起，不再回答', async () => {
    const message = createRequest('1', { kind: 'activity_unknown' });
    request(message);
    await settle();
    dismiss(message.request_id);
    await settle();
    pressButton('仍要退出');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(resolved).not.toHaveBeenCalled();
  });
});
