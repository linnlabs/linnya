import { describe, expect, it, vi } from 'vitest';
import type { IpcRendererEvent } from 'electron';
import {
  COMMAND_APPROVAL_CHANGED_CHANNEL,
  COMMAND_APPROVAL_PAGE_OPEN_CHANNEL,
  COMMAND_APPROVAL_REPLY_CHANNEL,
  COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL,
  COMMAND_PROTECTED_INPUT_CHANNEL,
} from '@app/schemas/commands';
import {
  buildCommandRuntimePreloadApi,
  type CommandRuntimeIpcRenderer,
} from './command-runtime-preload';

describe('command runtime preload', () => {
  it('只暴露审批 open/reply/change，且订阅可精确解除', async () => {
    let changedListener: ((event: IpcRendererEvent, payload: unknown) => void) | undefined;
    const invoke = vi.fn(async () => ({ success: true }));
    const ipcRenderer: CommandRuntimeIpcRenderer = {
      invoke,
      on(channel, listener) {
        expect(channel).toBe(COMMAND_APPROVAL_CHANGED_CHANNEL);
        changedListener = listener;
      },
      removeListener(channel, listener) {
        expect(channel).toBe(COMMAND_APPROVAL_CHANGED_CHANNEL);
        if (changedListener === listener) changedListener = undefined;
      },
    };
    const api = buildCommandRuntimePreloadApi(ipcRenderer);

    await api.openCommandApprovalPage();
    await api.replyToCommandApproval({ choice: 'deny' });
    expect(invoke.mock.calls).toEqual([
      [COMMAND_APPROVAL_PAGE_OPEN_CHANNEL],
      [COMMAND_APPROVAL_REPLY_CHANNEL, { choice: 'deny' }],
    ]);

    const unsubscribe = api.onCommandApprovalChanged(() => {});
    expect(changedListener).toBeDefined();
    unsubscribe();
    expect(changedListener).toBeUndefined();
  });

  it('保护输入和页面关闭只通过各自窄 channel 转发', async () => {
    const invoke = vi.fn(async () => ({ status: 'accepted' }));
    const ipcRenderer: CommandRuntimeIpcRenderer = {
      invoke,
      on() {},
      removeListener() {},
    };
    const api = buildCommandRuntimePreloadApi(ipcRenderer);
    const protectedSubmission = {
      page_ticket: 'page-ticket',
      protected_input_ticket: 'protected-ticket',
      input: 'private-value',
    };

    await api.submitCommandProtectedInput(protectedSubmission);
    await api.closeCommandCardControlPage({ page_ticket: 'page-ticket' });
    expect(invoke.mock.calls).toEqual([
      [COMMAND_PROTECTED_INPUT_CHANNEL, protectedSubmission],
      [COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL, { page_ticket: 'page-ticket' }],
    ]);
  });
});
