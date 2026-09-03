import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_PROTECTED_INPUT_CHANNEL,
} from '@app/schemas/commands';
import type { CommandCardControlHost } from 'src/app-hosts/linnya/adapters/commands/command-card-control-host';

type IpcHandler = (event: { readonly sender: { readonly id: number } }, raw: unknown) => Promise<unknown>;
const registeredHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

describe('command protected input IPC', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    vi.resetModules();
  });

  it('只信任 event.sender.id，严格 payload 失败时不让正文触达 host', async () => {
    const submissions: Array<Parameters<CommandCardControlHost['submitProtectedInput']>[0]> = [];
    const host = {
      async submitProtectedInput(input) {
        submissions.push(input);
        return { status: 'accepted' as const };
      },
    } satisfies Pick<CommandCardControlHost, 'submitProtectedInput'>;
    const { registerCommandProtectedInputHandler } = await import('./command-protected-input-ipc');
    registerCommandProtectedInputHandler({ host });
    const handler = registeredHandlers.get(COMMAND_PROTECTED_INPUT_CHANNEL);
    if (!handler) throw new Error('protected input handler 未注册');
    const sender = { id: 73 };
    const submission = {
      page_ticket: 'command_control_page_00000000-0000-4000-8000-000000000021',
      protected_input_ticket: 'command_protected_input_ticket_00000000-0000-4000-8000-000000000022',
      input: 'private-value',
    };

    await expect(handler({ sender }, { ...submission, owner_id: 999 })).resolves.toEqual({
      status: 'stale',
    });
    expect(submissions).toEqual([]);
    await expect(handler({ sender }, submission)).resolves.toEqual({ status: 'accepted' });
    expect(submissions).toEqual([{ ownerId: 73, submission }]);
  });
});
