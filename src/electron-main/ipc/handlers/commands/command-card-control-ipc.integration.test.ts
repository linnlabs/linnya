import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_CARD_CONTROL_CHANGED_CHANNEL,
  COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL,
  COMMAND_CARD_CONTROL_PAGE_OPEN_CHANNEL,
  CommandCardControlPageSnapshotV1Schema,
  type CommandCardControlPageSnapshotV1,
} from '@app/schemas/commands';
import type { CommandCardControlHost } from 'src/app-hosts/linnya/adapters/commands/command-card-control-host';

class TestSender extends EventEmitter {
  readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean { return false; }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
}

type IpcHandler = (event: { readonly sender: TestSender }, raw: unknown) => Promise<unknown>;
const registeredHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function requireItem<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (!value) throw new Error(`test item ${index} unavailable`);
  return value;
}

function createSender(id: number): TestSender {
  return new TestSender(id);
}

function snapshot(input: {
  readonly conversationId: string;
  readonly ticketSuffix: string;
}): CommandCardControlPageSnapshotV1 {
  return CommandCardControlPageSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_card_control_page_snapshot',
    page_ticket: `command_control_page_918f47a8-7f3c-4cc7-8b8c-${input.ticketSuffix}`,
    conversation_id: input.conversationId,
    capabilities: [],
    settlements: [],
    settlement_failures: [],
    audit_failures: [],
  });
}

function createHostFixture() {
  let changedListener = () => {};
  let openPage: CommandCardControlHost['openRendererPage'] = async () => undefined;
  let readPage: CommandCardControlHost['readRendererPage'] = async () => undefined;
  const invalidations: Array<{ readonly ownerId: number; readonly pageTicket: string }> = [];
  const host: CommandCardControlHost = {
    bindRuntime() {},
    openRendererPage(ownerId, conversationId) { return openPage(ownerId, conversationId); },
    readRendererPage(input) { return readPage(input); },
    invalidateRendererPage(input) { invalidations.push(input); },
    reportAuditFailure() {},
    hasAuditFailure() { return false; },
    async cancel() { return { status: 'stale' }; },
    async submitProtectedInput() { return { status: 'stale' }; },
    async drainProtectedInputs() {},
    async drainConversation() {},
    async deleteConversationSettlements() {},
    async endAndDrain() {},
    subscribe(listener) {
      changedListener = listener;
      return () => { changedListener = () => {}; };
    },
  };
  return {
    host,
    invalidations,
    emitChanged: () => changedListener(),
    setOpenPage(next: CommandCardControlHost['openRendererPage']) { openPage = next; },
    setReadPage(next: CommandCardControlHost['readRendererPage']) { readPage = next; },
  };
}

async function register(host: CommandCardControlHost, logger = { error: vi.fn() }) {
  const { registerCommandCardControlHandlers } = await import('./command-card-control-ipc');
  registerCommandCardControlHandlers({ host, logger });
  const open = registeredHandlers.get(COMMAND_CARD_CONTROL_PAGE_OPEN_CHANNEL);
  if (!open) throw new Error('command card control open handler 未注册');
  const close = registeredHandlers.get(COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL);
  if (!close) throw new Error('command card control close handler 未注册');
  return { open, close, logger };
}

describe('command card control IPC lifecycle', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    vi.resetModules();
  });

  it('A→B→A 并发 open 只提交最后一页，迟到结果不能清理或覆盖新页', async () => {
    const fixture = createHostFixture();
    const pending = [
      createDeferred<CommandCardControlPageSnapshotV1>(),
      createDeferred<CommandCardControlPageSnapshotV1>(),
      createDeferred<CommandCardControlPageSnapshotV1>(),
    ];
    let openIndex = 0;
    fixture.setOpenPage(() => requireItem(pending, openIndex++).promise);
    const { open } = await register(fixture.host);
    const sender = createSender(71);

    const firstA = open({ sender }, { conversation_id: 'conversation-a' });
    const middleB = open({ sender }, { conversation_id: 'conversation-b' });
    const lastA = open({ sender }, { conversation_id: 'conversation-a' });
    const current = snapshot({ conversationId: 'conversation-a', ticketSuffix: '000000000003' });
    requireItem(pending, 2).resolve(current);
    await lastA;

    const staleB = snapshot({ conversationId: 'conversation-b', ticketSuffix: '000000000002' });
    requireItem(pending, 1).resolve(staleB);
    await middleB;
    const staleA = snapshot({ conversationId: 'conversation-a', ticketSuffix: '000000000001' });
    requireItem(pending, 0).resolve(staleA);
    await firstA;

    expect(fixture.invalidations).toEqual([
      { ownerId: 71, pageTicket: staleB.page_ticket },
      { ownerId: 71, pageTicket: staleA.page_ticket },
    ]);
    expect(sender.listenerCount('did-start-navigation')).toBe(1);
    sender.emit('did-start-navigation');
    expect(fixture.invalidations[fixture.invalidations.length - 1]).toEqual({
      ownerId: 71,
      pageTicket: current.page_ticket,
    });
  });

  it('旧页面投影失败不能误删新页面，新页面仍可收到后续串行投影', async () => {
    const fixture = createHostFixture();
    const pageA = snapshot({ conversationId: 'conversation-a', ticketSuffix: '000000000011' });
    const pageB = snapshot({ conversationId: 'conversation-b', ticketSuffix: '000000000012' });
    fixture.setOpenPage(async (_ownerId, conversationId) => (
      conversationId === 'conversation-a' ? pageA : pageB
    ));
    const staleRead = createDeferred<CommandCardControlPageSnapshotV1 | undefined>();
    let readCount = 0;
    fixture.setReadPage(async () => {
      readCount += 1;
      if (readCount === 1) return staleRead.promise;
      return pageB;
    });
    const logger = { error: vi.fn() };
    const { open } = await register(fixture.host, logger);
    const sender = createSender(72);
    await open({ sender }, { conversation_id: 'conversation-a' });
    fixture.emitChanged();
    await Promise.resolve();
    await open({ sender }, { conversation_id: 'conversation-b' });
    staleRead.reject(new Error('stale projection failure'));
    await Promise.resolve();
    await Promise.resolve();

    fixture.emitChanged();
    await vi.waitFor(() => expect(sender.sent).toHaveLength(1));
    expect(fixture.invalidations).toEqual([{ ownerId: 72, pageTicket: pageA.page_ticket }]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(sender.sent).toEqual([{
      channel: COMMAND_CARD_CONTROL_CHANGED_CHANNEL,
      payload: expect.objectContaining({ snapshot: pageB }),
    }]);
  });

  it('关闭页面只接受当前 sender 持有的页面票据，并同步释放生命周期监听器', async () => {
    const fixture = createHostFixture();
    const page = snapshot({ conversationId: 'conversation-protected', ticketSuffix: '000000000021' });
    fixture.setOpenPage(async () => page);
    const { open, close } = await register(fixture.host);
    const sender = createSender(73);
    await open({ sender }, { conversation_id: 'conversation-protected' });

    await expect(close({ sender }, { page_ticket: page.page_ticket })).resolves.toEqual({
      status: 'closed',
    });
    expect(fixture.invalidations).toContainEqual({ ownerId: 73, pageTicket: page.page_ticket });
    expect(sender.listenerCount('did-start-navigation')).toBe(0);
  });
});
