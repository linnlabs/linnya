import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandCardControlPageOpenResultV1Schema,
  CommandProcessHandleSchema,
  type CommandCardCancelResultV1,
  type CommandCardControlPageOpenResultV1,
  type CommandProtectedInputResultV1,
} from '@app/schemas/commands';
import type { CommandCardControlGateway } from '../infrastructure/commandCardControlGateway';
import { useCommandCardControlStore } from '../store/commandCardControlStore';
import {
  cancelCommandFromCurrentCard,
  createCommandCardControlPageOwner,
  submitProtectedInputFromCurrentCard,
  type CommandCardControlPageOwner,
} from './useCommandCardControl';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => {};
  let reject = (_error: unknown): void => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function requireItem<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (!value) throw new Error(`test item ${index} unavailable`);
  return value;
}

const HANDLE = CommandProcessHandleSchema.parse(
  'command_process_00000000-0000-4000-8000-000000000003',
);
const OTHER_HANDLE = CommandProcessHandleSchema.parse(
  'command_process_00000000-0000-4000-8000-000000000004',
);

const CONTROL_GATEWAY_DEFAULTS = {
  closePage: async () => ({ status: 'closed' as const }),
  submitProtectedInput: async () => ({ status: 'stale' as const }),
};

let mountedOwner: CommandCardControlPageOwner | undefined;

function ensureCommandCardControlPage(
  conversationId: string,
  gateway: CommandCardControlGateway,
): Promise<void> {
  mountedOwner ??= createCommandCardControlPageOwner(gateway);
  return mountedOwner.ensure(conversationId);
}

function unmountCommandCardControlPage(): void {
  mountedOwner?.release();
  mountedOwner = undefined;
}

function openResult(conversationId: string, suffix: number): CommandCardControlPageOpenResultV1 {
  return CommandCardControlPageOpenResultV1Schema.parse({
    success: true,
    snapshot: {
      protocol_version: 1,
      kind: 'command_card_control_page_snapshot',
      page_ticket: `command_control_page_00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
      conversation_id: conversationId,
      capabilities: [{
        protocol_version: 1,
        kind: 'command_card_control_capability',
        process_handle: HANDLE,
        control_ticket: `command_control_ticket_00000000-0000-4000-8000-${String(suffix + 100).padStart(12, '0')}`,
        protected_input_ticket: `command_protected_input_ticket_00000000-0000-4000-8000-${String(suffix + 200).padStart(12, '0')}`,
      }],
      settlements: [],
      settlement_failures: [],
      audit_failures: [],
    },
  });
}

afterEach(() => unmountCommandCardControlPage());

describe('renderer command card control page generation', () => {
  it('旧 ConversationHost 的 owner 不能关闭后来激活的控制页面', async () => {
    setActivePinia(createPinia());
    const closePage = vi.fn().mockResolvedValue({ status: 'closed' as const });
    let sequence = 80;
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      closePage,
      openPage: async conversation => openResult(conversation, ++sequence),
      cancel: async () => ({ status: 'stale' }),
      subscribe: () => () => {},
    };
    const oldOwner = createCommandCardControlPageOwner(gateway);
    const currentOwner = createCommandCardControlPageOwner(gateway);
    await oldOwner.ensure('A');
    await currentOwner.ensure('B');
    const currentTicket = useCommandCardControlStore().snapshot?.page_ticket;

    oldOwner.release();
    expect(closePage).not.toHaveBeenCalled();
    expect(useCommandCardControlStore().snapshot?.page_ticket).toBe(currentTicket);

    currentOwner.release();
    await vi.waitFor(() => expect(closePage).toHaveBeenCalledWith(currentTicket));
    expect(useCommandCardControlStore().snapshot).toBeUndefined();
  });

  it('owner 在 open 返回前释放时，迟到页面用自己的 ticket 完成撤销', async () => {
    setActivePinia(createPinia());
    const opened = deferred<CommandCardControlPageOpenResultV1>();
    const closePage = vi.fn().mockResolvedValue({ status: 'closed' as const });
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      closePage,
      openPage: async () => opened.promise,
      cancel: async () => ({ status: 'stale' }),
      subscribe: () => () => {},
    };
    const owner = createCommandCardControlPageOwner(gateway);
    const opening = owner.ensure('A');
    owner.release();
    const late = openResult('A', 95);
    opened.resolve(late);

    await opening;
    if (!late.success) throw new Error('late page unavailable');
    expect(closePage).toHaveBeenCalledWith(late.snapshot.page_ticket);
    expect(useCommandCardControlStore().snapshot).toBeUndefined();
  });

  it('保护输入只提交一次当前页 ticket，失败不自动重试且不写入 store', async () => {
    setActivePinia(createPinia());
    const submitProtectedInput = vi.fn().mockResolvedValue({
      status: 'failed' as const,
      code: 'interaction_failed' as const,
    });
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async conversation => openResult(conversation, 61),
      cancel: async () => ({ status: 'stale' }),
      submitProtectedInput,
      subscribe: () => () => {},
    };
    await ensureCommandCardControlPage('A', gateway);

    await expect(submitProtectedInputFromCurrentCard(
      HANDLE,
      'private-value',
      gateway,
    )).resolves.toEqual({ status: 'failed', code: 'interaction_failed' });
    expect(submitProtectedInput).toHaveBeenCalledOnce();
    expect(JSON.stringify(useCommandCardControlStore().$state)).not.toContain('private-value');
  });

  it('离开对话页时关闭主进程页面票据，迟到保护输入结果不能覆盖新页', async () => {
    setActivePinia(createPinia());
    const reply = deferred<CommandProtectedInputResultV1>();
    const closePage = vi.fn().mockResolvedValue({ status: 'closed' as const });
    let sequence = 70;
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      closePage,
      openPage: async conversation => openResult(conversation, ++sequence),
      cancel: async () => ({ status: 'stale' }),
      submitProtectedInput: async () => reply.promise,
      subscribe: () => () => {},
    };
    await ensureCommandCardControlPage('A', gateway);
    const oldPageTicket = useCommandCardControlStore().snapshot?.page_ticket;
    const submitting = submitProtectedInputFromCurrentCard(HANDLE, 'private-value', gateway);
    unmountCommandCardControlPage();
    await vi.waitFor(() => expect(closePage).toHaveBeenCalledWith(oldPageTicket));
    await ensureCommandCardControlPage('B', gateway);
    const currentPageTicket = useCommandCardControlStore().snapshot?.page_ticket;
    reply.resolve({ status: 'accepted' });

    await expect(submitting).resolves.toEqual({ status: 'stale' });
    expect(useCommandCardControlStore().snapshot?.page_ticket).toBe(currentPageTicket);
    expect(JSON.stringify(useCommandCardControlStore().$state)).not.toContain('private-value');
  });

  it('A→B→A 只接受最后一代 open，早到或晚到响应都不能覆盖当前页', async () => {
    setActivePinia(createPinia());
    const opens = [
      deferred<CommandCardControlPageOpenResultV1>(),
      deferred<CommandCardControlPageOpenResultV1>(),
      deferred<CommandCardControlPageOpenResultV1>(),
    ];
    let index = 0;
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async () => requireItem(opens, index++).promise,
      cancel: async () => ({ status: 'stale' }),
      subscribe: () => () => {},
    };
    const firstA = ensureCommandCardControlPage('A', gateway);
    const b = ensureCommandCardControlPage('B', gateway);
    const secondA = ensureCommandCardControlPage('A', gateway);
    requireItem(opens, 0).resolve(openResult('A', 1));
    requireItem(opens, 1).resolve(openResult('B', 2));
    await Promise.all([firstA, b]);
    expect(useCommandCardControlStore().snapshot).toBeUndefined();
    requireItem(opens, 2).resolve(openResult('A', 3));
    await secondA;
    expect(useCommandCardControlStore().snapshot?.page_ticket).toContain('000000000003');
  });

  it('旧 page 的迟到 cancel 结果不能覆盖 A→B→A 后的新 ticket', async () => {
    setActivePinia(createPinia());
    const cancelReply = deferred<CommandCardCancelResultV1>();
    let openSequence = 0;
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async conversation => openResult(conversation, ++openSequence),
      cancel: async () => cancelReply.promise,
      subscribe: () => () => {},
    };
    await ensureCommandCardControlPage('A', gateway);
    const cancelling = cancelCommandFromCurrentCard(HANDLE, gateway);
    await ensureCommandCardControlPage('B', gateway);
    await ensureCommandCardControlPage('A', gateway);
    const currentTicket = useCommandCardControlStore().snapshot?.page_ticket;
    cancelReply.resolve({ status: 'stale' });
    await cancelling;
    expect(useCommandCardControlStore().snapshot?.page_ticket).toBe(currentTicket);
    expect(useCommandCardControlStore().snapshot?.capabilities).toHaveLength(1);
  });

  it('旧 page 的迟到 cancel 结果不能清除新 page 正在进行的同 handle 操作', async () => {
    setActivePinia(createPinia());
    const oldReply = deferred<CommandCardCancelResultV1>();
    const currentReply = deferred<CommandCardCancelResultV1>();
    let cancelIndex = 0;
    let openSequence = 10;
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async conversation => openResult(conversation, ++openSequence),
      cancel: async () => (cancelIndex++ === 0 ? oldReply.promise : currentReply.promise),
      subscribe: () => () => {},
    };
    await ensureCommandCardControlPage('A', gateway);
    const oldCancel = cancelCommandFromCurrentCard(HANDLE, gateway);
    await ensureCommandCardControlPage('B', gateway);
    await ensureCommandCardControlPage('A', gateway);
    const currentCancel = cancelCommandFromCurrentCard(HANDLE, gateway);

    oldReply.resolve({ status: 'stale' });
    await oldCancel;
    expect(useCommandCardControlStore().cancellingHandle).toBe(HANDLE);

    currentReply.resolve({ status: 'failed', code: 'action_conflict' });
    await currentCancel;
    expect(useCommandCardControlStore().failedHandle).toBe(HANDLE);
  });

  it('旧 page 的迟到 cancel rejection 不能清除或标坏新 page 的同 handle 操作', async () => {
    setActivePinia(createPinia());
    const oldReply = deferred<CommandCardCancelResultV1>();
    const currentReply = deferred<CommandCardCancelResultV1>();
    let cancelIndex = 0;
    let openSequence = 20;
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async conversation => openResult(conversation, ++openSequence),
      cancel: async () => (cancelIndex++ === 0 ? oldReply.promise : currentReply.promise),
      subscribe: () => () => {},
    };
    await ensureCommandCardControlPage('A', gateway);
    const oldCancel = cancelCommandFromCurrentCard(HANDLE, gateway);
    await ensureCommandCardControlPage('B', gateway);
    await ensureCommandCardControlPage('A', gateway);
    const currentCancel = cancelCommandFromCurrentCard(HANDLE, gateway);

    oldReply.reject(new Error('stale IPC failure'));
    await oldCancel;
    expect(useCommandCardControlStore()).toMatchObject({
      cancellingHandle: HANDLE,
      failedHandle: undefined,
    });

    currentReply.resolve({ status: 'failed', code: 'action_conflict' });
    await currentCancel;
    expect(useCommandCardControlStore().failedHandle).toBe(HANDLE);
  });

  it('取消完成在当前同页快照上合并，不覆盖等待期间到达的其他命令终态', async () => {
    setActivePinia(createPinia());
    const cancelReply = deferred<CommandCardCancelResultV1>();
    let changed: Parameters<CommandCardControlGateway['subscribe']>[0] = () => {};
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async conversation => openResult(conversation, 41),
      cancel: async () => cancelReply.promise,
      subscribe(listener) {
        changed = listener;
        return () => {};
      },
    };
    await ensureCommandCardControlPage('A', gateway);
    const cancelling = cancelCommandFromCurrentCard(HANDLE, gateway);
    const original = useCommandCardControlStore().snapshot;
    if (!original) throw new Error('control snapshot unavailable');
    const otherSettlement = {
      protocol_version: 1 as const,
      kind: 'command_card_execution_settlement' as const,
      conversation_id: 'A',
      process_handle: OTHER_HANDLE,
      started_at_ms: 10,
      settled_at_ms: 20,
      audit_status: 'complete' as const,
      terminal: { outcome: 'exited' as const, exitCode: 0, signal: null },
    };
    changed({
      protocol_version: 1,
      kind: 'command_card_control_changed',
      snapshot: { ...original, settlements: [otherSettlement] },
    });

    cancelReply.resolve({
      status: 'settled',
      settlement: {
        ...otherSettlement,
        process_handle: HANDLE,
        settled_at_ms: 30,
      },
    });
    await cancelling;
    expect(useCommandCardControlStore().snapshot?.settlements).toEqual([
      otherSettlement,
      expect.objectContaining({ process_handle: HANDLE }),
    ]);
  });

  it('同页 action conflict 重签 ticket 时保留取消失败提示，直到下一次操作', async () => {
    setActivePinia(createPinia());
    let changed: Parameters<CommandCardControlGateway['subscribe']>[0] = () => {};
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async conversation => openResult(conversation, 21),
      cancel: async () => ({ status: 'failed', code: 'action_conflict' }),
      subscribe(listener) {
        changed = listener;
        return () => {};
      },
    };
    await ensureCommandCardControlPage('A', gateway);
    const original = useCommandCardControlStore().snapshot;
    if (!original) throw new Error('control snapshot unavailable');

    await cancelCommandFromCurrentCard(HANDLE, gateway);
    expect(useCommandCardControlStore().failedHandle).toBe(HANDLE);
    const originalCapability = original.capabilities[0];
    if (!originalCapability) throw new Error('control capability unavailable');
    changed({
      protocol_version: 1,
      kind: 'command_card_control_changed',
      snapshot: {
        ...original,
        capabilities: [{
          ...originalCapability,
          control_ticket: 'command_control_ticket_00000000-0000-4000-8000-000000000222',
        }],
      },
    });
    expect(useCommandCardControlStore().failedHandle).toBe(HANDLE);

    const retry = cancelCommandFromCurrentCard(HANDLE, gateway);
    expect(useCommandCardControlStore().failedHandle).toBeUndefined();
    await retry;
  });

  it('owner unavailable 结束当前取消状态，页面恢复后不会永久禁用按钮', async () => {
    setActivePinia(createPinia());
    let openSequence = 30;
    const gateway: CommandCardControlGateway = {
      ...CONTROL_GATEWAY_DEFAULTS,
      openPage: async conversation => openResult(conversation, ++openSequence),
      cancel: async () => ({ status: 'failed', code: 'owner_unavailable' }),
      subscribe: () => () => {},
    };
    await ensureCommandCardControlPage('A', gateway);
    await cancelCommandFromCurrentCard(HANDLE, gateway);
    expect(useCommandCardControlStore()).toMatchObject({
      pageUnavailable: true,
      cancellingHandle: undefined,
    });

    await ensureCommandCardControlPage('A', gateway);
    expect(useCommandCardControlStore()).toMatchObject({
      pageUnavailable: false,
      cancellingHandle: undefined,
    });
  });
});
