import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_APPROVAL_CHANGED_CHANNEL,
  COMMAND_APPROVAL_PAGE_OPEN_CHANNEL,
  COMMAND_APPROVAL_REPLY_CHANNEL,
  CommandApprovalPageOpenResultV1Schema,
  parseCommandApprovalRequest,
  type CommandApprovalRequestV1,
} from '@app/schemas/commands';
import {
  createCommandApprovalHost,
  createLocalCommandApprovalRendererGateway,
} from 'src/app-hosts/linnya/adapters/commands/approval-host';

type IpcHandler = (event: FakeIpcEvent, raw?: unknown) => unknown;
const registeredHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

class FakeSender extends EventEmitter {
  readonly id: number;
  readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
  destroyed = false;
  failSend = false;

  constructor(id: number) {
    super();
    this.id = id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, payload: unknown): void {
    if (this.failSend) throw new Error('renderer was destroyed during send');
    this.sent.push({ channel, payload });
  }
}

interface FakeIpcEvent {
  readonly sender: FakeSender;
}

function approvalRequest(index: number): CommandApprovalRequestV1 {
  const identity = {
    conversation_id: 'conversation-ipc',
    agent_run_id: 'run-ipc',
    origin_tool_call_id: `shell-call-${index}`,
    command_execution_id: `command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${index}`,
    owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d20',
    created_at_ms: 1_000 + index,
  };
  return parseCommandApprovalRequest({
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: `command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${index}`,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: `rm file-${index}.txt`,
      cwd: '/tmp/ipc',
      permission: {
        protocol_version: 1,
        kind: 'command_permission_snapshot',
        identity,
        base_level: 'standard',
        effective_level: 'standard',
        grant_source: 'global_setting',
        internal_data_access: 'allowed',
      },
    },
    reasons: [{ type: 'fixed_risk_rule', rule_id: 'delete.file', category: 'delete' }],
    available_choices: ['allow_once', 'deny'],
    requested_at_ms: 1_100 + index,
  });
}

describe('command approval IPC', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    vi.resetModules();
  });

  it('main pending 变化投影到当前页面，reply 只携带 ticket/request/choice', async () => {
    const host = createCommandApprovalHost({ createUuid: () => 'ipc-page' });
    const { registerCommandApprovalHandlers } = await import('./command-approval-ipc');
    registerCommandApprovalHandlers({
      host: createLocalCommandApprovalRendererGateway(host),
    });
    const sender = new FakeSender(41);
    const event = { sender };
    const open = registeredHandlers.get(COMMAND_APPROVAL_PAGE_OPEN_CHANNEL);
    const reply = registeredHandlers.get(COMMAND_APPROVAL_REPLY_CHANNEL);
    if (!open || !reply) throw new Error('command approval IPC handlers were not registered');

    const opened = CommandApprovalPageOpenResultV1Schema.parse(await open(event));
    expect(opened.success).toBe(true);
    if (!opened.success) return;
    const request = approvalRequest(1);
    const response = host.request({ request });
    await vi.waitFor(() => {
      expect(sender.sent[sender.sent.length - 1]).toMatchObject({
        channel: COMMAND_APPROVAL_CHANGED_CHANNEL,
        payload: { snapshot: { pending: [{ command: 'rm file-1.txt' }] } },
      });
    });

    expect(await reply(event, {
      protocol_version: 1,
      kind: 'command_approval_reply_submission',
      page_ticket: opened.snapshot.page_ticket,
      approval_request_id: request.approval_request_id,
      choice: 'deny',
    })).toEqual({ success: true, status: 'accepted' });
    await expect(response).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'deny' },
    });
    await vi.waitFor(() => {
      expect(sender.sent[sender.sent.length - 1]).toMatchObject({
        payload: { snapshot: { pending: [{ status: 'processing' }] } },
      });
    });
  });

  it('navigation 立即废止旧 ticket，malformed 与迟到回复都不能路由', async () => {
    const host = createCommandApprovalHost({ createUuid: () => 'ipc-page' });
    const { registerCommandApprovalHandlers } = await import('./command-approval-ipc');
    registerCommandApprovalHandlers({
      host: createLocalCommandApprovalRendererGateway(host),
    });
    const sender = new FakeSender(42);
    const event = { sender };
    const open = registeredHandlers.get(COMMAND_APPROVAL_PAGE_OPEN_CHANNEL);
    const reply = registeredHandlers.get(COMMAND_APPROVAL_REPLY_CHANNEL);
    if (!open || !reply) throw new Error('command approval IPC handlers were not registered');
    const opened = CommandApprovalPageOpenResultV1Schema.parse(await open(event));
    if (!opened.success) return;
    const request = approvalRequest(2);
    const response = host.request({ request });

    expect(await reply(event, { unexpected: true })).toEqual({ success: true, status: 'stale' });
    sender.emit('did-start-navigation');
    expect(await reply(event, {
      protocol_version: 1,
      kind: 'command_approval_reply_submission',
      page_ticket: opened.snapshot.page_ticket,
      approval_request_id: request.approval_request_id,
      choice: 'allow_once',
    })).toEqual({ success: true, status: 'invalid_page' });

    host.endOwner();
    await expect(response).resolves.toEqual({
      status: 'invalidated',
      reason: 'owner_ended',
    });
  });

  it('isDestroyed 检查后的 send 竞态不打断 pending，reload 后仍可回复', async () => {
    let pageIndex = 0;
    const host = createCommandApprovalHost({
      createUuid: () => `ipc-page-${++pageIndex}`,
    });
    const { registerCommandApprovalHandlers } = await import('./command-approval-ipc');
    registerCommandApprovalHandlers({
      host: createLocalCommandApprovalRendererGateway(host),
    });
    const sender = new FakeSender(43);
    const event = { sender };
    const open = registeredHandlers.get(COMMAND_APPROVAL_PAGE_OPEN_CHANNEL);
    const reply = registeredHandlers.get(COMMAND_APPROVAL_REPLY_CHANNEL);
    if (!open || !reply) throw new Error('command approval IPC handlers were not registered');
    const firstPage = CommandApprovalPageOpenResultV1Schema.parse(await open(event));
    if (!firstPage.success) return;
    sender.failSend = true;
    const request = approvalRequest(3);

    const response = host.request({ request });
    sender.failSend = false;
    const reloaded = CommandApprovalPageOpenResultV1Schema.parse(await open(event));
    if (!reloaded.success) return;
    expect(reloaded.snapshot.pending).toHaveLength(1);
    expect(await reply(event, {
      protocol_version: 1,
      kind: 'command_approval_reply_submission',
      page_ticket: reloaded.snapshot.page_ticket,
      approval_request_id: request.approval_request_id,
      choice: 'allow_once',
    })).toEqual({ success: true, status: 'accepted' });
    await expect(response).resolves.toMatchObject({ status: 'replied' });
  });

  it('页面重开、导航和 owner 结束都会精准解绑三个 renderer 生命周期监听器', async () => {
    let pageIndex = 0;
    const host = createCommandApprovalHost({
      createUuid: () => `ipc-cleanup-${++pageIndex}`,
    });
    const { registerCommandApprovalHandlers } = await import('./command-approval-ipc');
    registerCommandApprovalHandlers({
      host: createLocalCommandApprovalRendererGateway(host),
    });
    const sender = new FakeSender(44);
    const event = { sender };
    const open = registeredHandlers.get(COMMAND_APPROVAL_PAGE_OPEN_CHANNEL);
    if (!open) throw new Error('command approval IPC open handler was not registered');

    expect(CommandApprovalPageOpenResultV1Schema.parse(await open(event)).success).toBe(true);
    expect(sender.listenerCount('did-start-navigation')).toBe(1);
    expect(sender.listenerCount('render-process-gone')).toBe(1);
    expect(sender.listenerCount('destroyed')).toBe(1);

    expect(CommandApprovalPageOpenResultV1Schema.parse(await open(event)).success).toBe(true);
    expect(sender.listenerCount('did-start-navigation')).toBe(1);
    expect(sender.listenerCount('render-process-gone')).toBe(1);
    expect(sender.listenerCount('destroyed')).toBe(1);

    sender.emit('did-start-navigation');
    expect(sender.listenerCount('did-start-navigation')).toBe(0);
    expect(sender.listenerCount('render-process-gone')).toBe(0);
    expect(sender.listenerCount('destroyed')).toBe(0);

    expect(CommandApprovalPageOpenResultV1Schema.parse(await open(event)).success).toBe(true);
    host.endOwner();
    await vi.waitFor(() => {
      expect(sender.listenerCount('did-start-navigation')).toBe(0);
      expect(sender.listenerCount('render-process-gone')).toBe(0);
      expect(sender.listenerCount('destroyed')).toBe(0);
    });
  });
});
