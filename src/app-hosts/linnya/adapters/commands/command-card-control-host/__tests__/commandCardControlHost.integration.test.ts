import { describe, expect, it, vi } from 'vitest';
import {
  CommandExecutionTerminalV1Schema,
  parseCommandExecutionOwnerBinding,
  type CommandCardControlPageSnapshotV1,
  type CommandExecutionTerminalV1,
} from '@app/schemas/commands';
import type {
  CommandCardSettlementPort,
  CommandExecutionLifecycleEvent,
  CommandProcessCancellationResult,
} from 'src/domains/commands';
import { createCommandCardControlHost } from '../orchestration/createCommandCardControlHost';

const BINDING = parseCommandExecutionOwnerBinding({
  protocol_version: 1,
  kind: 'command_execution_owner_binding',
  identity: {
    command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000001',
    conversation_id: 'conversation-control-test',
    agent_run_id: 'agent-run-control-test',
    origin_tool_call_id: 'origin-tool-control-test',
    owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000002',
    created_at_ms: 50,
  },
  process_handle: 'command_process_00000000-0000-4000-8000-000000000003',
  mode: 'pipe',
});

const PTY_BINDING = parseCommandExecutionOwnerBinding({
  ...BINDING,
  identity: {
    ...BINDING.identity,
    command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000021',
  },
  process_handle: 'command_process_00000000-0000-4000-8000-000000000023',
  mode: 'pty',
});

function deferred<T>() {
  let resolve = (_value: T): void => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const TERMINAL: CommandExecutionTerminalV1 = CommandExecutionTerminalV1Schema.parse({
  protocol_version: 1,
  kind: 'command_execution_terminal',
  identity: BINDING.identity,
  settled_at_ms: 200,
  outcome: 'execution_ended',
  termination_cause: 'user_cancelled',
  process_exit: { status: 'observed', exit_code: null, signal: 'SIGTERM' },
  output_drain: { status: 'complete' },
  tree_cleanup: { status: 'succeeded' },
  resource_release: { status: 'succeeded' },
});

function firstCapability(snapshot: CommandCardControlPageSnapshotV1) {
  const capability = snapshot.capabilities[0];
  if (!capability) throw new Error('control capability unavailable');
  return capability;
}

function fixture(input: {
  readonly failPersistence?: boolean;
  readonly persistenceError?: Error;
  readonly reportPersistenceFailure?: (context: {
    readonly conversationId: string;
    readonly processHandle: string;
    readonly error: unknown;
  }) => void;
} = {}) {
  let listener: ((event: CommandExecutionLifecycleEvent) => void) | undefined;
  const settlements = new Map<string, Awaited<ReturnType<CommandCardSettlementPort['listForConversation']>>[number]>();
  const persistence: CommandCardSettlementPort = {
    async recordTerminal(record) {
      if (input.failPersistence) {
        throw input.persistenceError ?? new Error('injected persistence failure');
      }
      const settlement = {
        protocol_version: 1 as const,
        kind: 'command_card_execution_settlement' as const,
        conversation_id: record.binding.identity.conversation_id,
        process_handle: record.binding.process_handle,
        started_at_ms: record.startedAtMs,
        settled_at_ms: record.terminal.settled_at_ms,
        audit_status: record.auditStatus,
        terminal: {
          outcome: 'terminated' as const,
          reason: 'cancelled' as const,
          exitCode: null,
          signal: 'SIGTERM',
        },
      };
      settlements.set(record.binding.process_handle, settlement);
      return { status: 'recorded' as const, settlement };
    },
    async markAuditIncomplete(binding) {
      const settlement = settlements.get(binding.process_handle);
      if (!settlement) return { status: 'terminal_not_recorded' as const };
      const updated = { ...settlement, audit_status: 'incomplete' as const };
      settlements.set(binding.process_handle, updated);
      return { status: 'updated' as const, settlement: updated };
    },
    async listForConversation() { return Array.from(settlements.values()); },
    async deleteForConversation() { settlements.clear(); },
  };
  const cancelAndWait = vi.fn(async (): Promise<CommandProcessCancellationResult> => ({
    status: 'terminal' as const,
    processHandle: BINDING.process_handle,
    startedAtMs: 100,
    terminal: TERMINAL,
    settledTextOutput: {
      mode: 'pipe',
      stdout: { status: 'unavailable' },
      stderr: { status: 'unavailable' },
    },
  }));
  const submitProtectedInput = vi.fn().mockResolvedValue({ status: 'accepted' as const });
  const auditRecord = vi.fn().mockResolvedValue(undefined);
  const host = createCommandCardControlHost({
    createUuid: (() => {
      let sequence = 10;
      return () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
    })(),
    reportPersistenceFailure: input.reportPersistenceFailure,
  });
  const runtime: Parameters<typeof host.bindRuntime>[0] = {
    control: {
      cancelAndWait,
      controlInteraction: vi.fn(),
      submitProtectedInput,
    },
    audit: { record: auditRecord },
    lifecycle: {
      subscribeExecutionLifecycle(next) {
        listener = next;
        return () => { listener = undefined; };
      },
    },
    settlements: persistence,
  };
  host.bindRuntime(runtime);
  return {
    host,
    runtime,
    cancelAndWait,
    submitProtectedInput,
    auditRecord,
    publish: (event: CommandExecutionLifecycleEvent) => listener?.(event),
  };
}

describe('command card control host', () => {
  it('未绑定 runtime 时删除相关操作明确失败，不能静默伪装成功', async () => {
    const host = createCommandCardControlHost();
    await expect(host.drainConversation(BINDING.identity.conversation_id)).rejects.toThrow(
      'command card control runtime is not bound',
    );
    await expect(host.deleteConversationSettlements(BINDING.identity.conversation_id)).rejects.toThrow(
      'command card control runtime is not bound',
    );
  });

  it('同页 ticket 稳定，reload 后旧 ticket 失效，取消等待 owner terminal 与 durable settlement', async () => {
    const f = fixture();
    f.publish({ type: 'handle_published', binding: BINDING });
    const first = await f.host.openRendererPage(7, BINDING.identity.conversation_id);
    if (!first) throw new Error('page unavailable');
    const reread = await f.host.readRendererPage({ ownerId: 7, pageTicket: first.page_ticket });
    expect(reread?.capabilities[0]?.control_ticket).toBe(first.capabilities[0]?.control_ticket);

    const reloaded = await f.host.openRendererPage(7, BINDING.identity.conversation_id);
    if (!reloaded) throw new Error('reloaded page unavailable');
    await expect(f.host.cancel({
      ownerId: 7,
      submission: {
        page_ticket: first.page_ticket,
        control_ticket: firstCapability(first).control_ticket,
      },
    })).resolves.toEqual({ status: 'stale' });

    await expect(f.host.cancel({
      ownerId: 7,
      submission: {
        page_ticket: reloaded.page_ticket,
        control_ticket: firstCapability(reloaded).control_ticket,
      },
    })).resolves.toMatchObject({
      status: 'settled',
      settlement: { terminal: { outcome: 'terminated', reason: 'cancelled' } },
    });
    expect(f.cancelAndWait).toHaveBeenCalledOnce();
    const replay = await f.host.readRendererPage({ ownerId: 7, pageTicket: reloaded.page_ticket });
    expect(replay?.capabilities).toEqual([]);
    expect(replay?.settlements).toHaveLength(1);
  });

  it('只给 PTY 签发保护输入票据，同一票据并发提交仅一次触达 owner 且审计没有正文', async () => {
    const f = fixture();
    const controlled = deferred<{ readonly status: 'accepted' }>();
    f.submitProtectedInput.mockImplementationOnce(() => controlled.promise);
    f.publish({ type: 'handle_published', binding: BINDING });
    f.publish({ type: 'handle_published', binding: PTY_BINDING });
    const page = await f.host.openRendererPage(70, BINDING.identity.conversation_id);
    if (!page) throw new Error('page unavailable');
    const pipeCapability = page.capabilities.find(value => value.process_handle === BINDING.process_handle);
    const ptyCapability = page.capabilities.find(value => value.process_handle === PTY_BINDING.process_handle);
    expect(pipeCapability?.protected_input_ticket).toBeUndefined();
    if (!ptyCapability?.protected_input_ticket) throw new Error('PTY protected input unavailable');
    const submission = {
      page_ticket: page.page_ticket,
      protected_input_ticket: ptyCapability.protected_input_ticket,
      input: 'do-not-record-this-secret',
    };

    const first = f.host.submitProtectedInput({ ownerId: 70, submission });
    await expect(f.host.submitProtectedInput({ ownerId: 70, submission })).resolves.toEqual({
      status: 'stale',
    });
    expect(f.submitProtectedInput).toHaveBeenCalledOnce();
    controlled.resolve({ status: 'accepted' });
    await expect(first).resolves.toEqual({ status: 'accepted' });
    await f.host.drainProtectedInputs();

    expect(f.submitProtectedInput).toHaveBeenCalledWith({
      binding: PTY_BINDING,
      input: 'do-not-record-this-secret',
    });
    expect(f.auditRecord).toHaveBeenCalledOnce();
    const auditEvent: unknown = f.auditRecord.mock.calls[0]?.[0];
    expect(auditEvent).toMatchObject({
      kind: 'protected_input',
      identity: PTY_BINDING.identity,
      process_handle: PTY_BINDING.process_handle,
      input_bytes: 25,
      result: { status: 'accepted' },
    });
    expect(JSON.stringify(auditEvent)).not.toContain('do-not-record-this-secret');

    const refreshed = await f.host.readRendererPage({ ownerId: 70, pageTicket: page.page_ticket });
    const refreshedPty = refreshed?.capabilities.find(
      value => value.process_handle === PTY_BINDING.process_handle,
    );
    expect(refreshedPty?.protected_input_ticket).not.toBe(ptyCapability.protected_input_ticket);
  });

  it('保护输入审计失败只降级卡片审计事实，不重放秘密或改写真实输入结果', async () => {
    const f = fixture();
    f.auditRecord.mockRejectedValueOnce(new Error('audit unavailable'));
    f.publish({ type: 'handle_published', binding: PTY_BINDING });
    const page = await f.host.openRendererPage(71, PTY_BINDING.identity.conversation_id);
    const capability = page?.capabilities[0];
    if (!page || !capability?.protected_input_ticket) throw new Error('protected input unavailable');

    await expect(f.host.submitProtectedInput({
      ownerId: 71,
      submission: {
        page_ticket: page.page_ticket,
        protected_input_ticket: capability.protected_input_ticket,
        input: 'private',
      },
    })).resolves.toEqual({ status: 'accepted' });
    expect(f.submitProtectedInput).toHaveBeenCalledOnce();
    expect(f.host.hasAuditFailure(PTY_BINDING)).toBe(true);
  });

  it('保护输入仍在写入或审计时 drain 不得提前返回', async () => {
    const f = fixture();
    const inputWrite = deferred<{ readonly status: 'accepted' }>();
    const auditWrite = deferred<void>();
    f.submitProtectedInput.mockImplementationOnce(() => inputWrite.promise);
    f.auditRecord.mockImplementationOnce(() => auditWrite.promise);
    f.publish({ type: 'handle_published', binding: PTY_BINDING });
    const page = await f.host.openRendererPage(72, PTY_BINDING.identity.conversation_id);
    const capability = page?.capabilities[0];
    if (!page || !capability?.protected_input_ticket) throw new Error('protected input unavailable');

    const submission = f.host.submitProtectedInput({
      ownerId: 72,
      submission: {
        page_ticket: page.page_ticket,
        protected_input_ticket: capability.protected_input_ticket,
        input: 'private',
      },
    });
    let drained = false;
    const draining = f.host.drainProtectedInputs().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    inputWrite.resolve({ status: 'accepted' });
    await Promise.resolve();
    expect(drained).toBe(false);

    auditWrite.resolve();
    await expect(submission).resolves.toEqual({ status: 'accepted' });
    await draining;
    expect(drained).toBe(true);
  });

  it('终态卡片先落盘后收到审计失败时，单向降级 durable audit status', async () => {
    const f = fixture();
    f.publish({
      type: 'terminal_settled',
      binding: BINDING,
      startedAtMs: 100,
      terminal: TERMINAL,
    });
    await f.host.drainConversation(BINDING.identity.conversation_id);
    f.host.reportAuditFailure({ binding: BINDING });
    await f.host.drainConversation(BINDING.identity.conversation_id);

    const page = await f.host.openRendererPage(83, BINDING.identity.conversation_id);
    expect(page?.settlements).toMatchObject([{ audit_status: 'incomplete' }]);
    expect(page?.audit_failures).toEqual([BINDING.process_handle]);
  });

  it('owner 退出时保留已知审计失败，直到迟到终态按 incomplete 落盘', async () => {
    const f = fixture();
    f.host.reportAuditFailure({ binding: BINDING });
    f.publish({ type: 'owner_ending' });
    f.publish({
      type: 'terminal_settled',
      binding: BINDING,
      startedAtMs: 100,
      terminal: TERMINAL,
    });

    await f.host.drainConversation(BINDING.identity.conversation_id);
    const page = await f.host.openRendererPage(84, BINDING.identity.conversation_id);
    expect(page?.settlements).toMatchObject([{ audit_status: 'incomplete' }]);
  });

  it('自然终态持久化失败时撤销控制能力并投影明确失败，不伪装仍可取消', async () => {
    const f = fixture({ failPersistence: true });
    f.publish({ type: 'handle_published', binding: BINDING });
    const page = await f.host.openRendererPage(8, BINDING.identity.conversation_id);
    if (!page) throw new Error('page unavailable');
    f.publish({ type: 'terminal_settled', binding: BINDING, startedAtMs: 100, terminal: TERMINAL });
    await expect(f.host.drainConversation(BINDING.identity.conversation_id)).rejects.toThrow(
      'failed to persist 1 command card settlement(s) during conversation drain',
    );
    const replay = await f.host.readRendererPage({ ownerId: 8, pageTicket: page.page_ticket });
    expect(replay?.capabilities).toEqual([]);
    expect(replay?.settlements).toEqual([]);
    expect(replay?.settlement_failures).toEqual([BINDING.process_handle]);
  });

  it('单个坏 renderer listener 不阻断其他页面信号', () => {
    const f = fixture();
    let observed = 0;
    f.host.subscribe(() => { throw new Error('injected renderer listener failure'); });
    f.host.subscribe(() => { observed += 1; });
    expect(() => f.publish({ type: 'handle_published', binding: BINDING })).not.toThrow();
    expect(observed).toBe(1);
  });

  it('审计失败在当前 owner 内跨页面保留，并在遗忘、显式删除和 owner end 时精准清理', async () => {
    const f = fixture();
    const conversationId = BINDING.identity.conversation_id;
    const firstPage = await f.host.openRendererPage(82, conversationId);
    if (!firstPage) throw new Error('first page unavailable');

    f.host.reportAuditFailure({
      binding: BINDING,
    });
    expect(f.host.hasAuditFailure(BINDING)).toBe(true);
    const mismatchedBinding = parseCommandExecutionOwnerBinding({
      ...BINDING,
      identity: {
        ...BINDING.identity,
        agent_run_id: 'agent-run-control-test-mismatch',
      },
    });
    expect(f.host.hasAuditFailure(mismatchedBinding)).toBe(false);
    expect((await f.host.readRendererPage({
      ownerId: 82,
      pageTicket: firstPage.page_ticket,
    }))?.audit_failures).toEqual([BINDING.process_handle]);

    const otherConversationPage = await f.host.openRendererPage(82, 'conversation-other');
    expect(otherConversationPage?.audit_failures).toEqual([]);
    const returnedPage = await f.host.openRendererPage(82, conversationId);
    expect(returnedPage?.audit_failures).toEqual([BINDING.process_handle]);

    f.publish({ type: 'conversation_stopping', conversationId });
    expect((await f.host.readRendererPage({
      ownerId: 82,
      pageTicket: returnedPage?.page_ticket ?? firstPage.page_ticket,
    }))?.audit_failures).toEqual([BINDING.process_handle]);
    f.publish({ type: 'conversation_forgotten', conversationId });
    expect((await f.host.readRendererPage({
      ownerId: 82,
      pageTicket: returnedPage?.page_ticket ?? firstPage.page_ticket,
    }))?.audit_failures).toEqual([]);

    f.host.reportAuditFailure({ binding: BINDING });
    await f.host.deleteConversationSettlements(conversationId);
    expect((await f.host.readRendererPage({
      ownerId: 82,
      pageTicket: returnedPage?.page_ticket ?? firstPage.page_ticket,
    }))?.audit_failures).toEqual([]);

    f.host.reportAuditFailure({ binding: BINDING });
    await f.host.endAndDrain();
    f.host.bindRuntime(f.runtime);
    expect((await f.host.openRendererPage(82, conversationId))?.audit_failures).toEqual([]);
    await f.host.endAndDrain();
  });

  it('诊断 logger 自身失败时仍结算持久化失败，不让取消 waiter 挂起', async () => {
    const f = fixture({
      failPersistence: true,
      reportPersistenceFailure() { throw new Error('injected logger failure'); },
    });
    f.publish({ type: 'handle_published', binding: BINDING });
    const page = await f.host.openRendererPage(81, BINDING.identity.conversation_id);
    if (!page) throw new Error('page unavailable');
    f.publish({ type: 'terminal_settled', binding: BINDING, startedAtMs: 100, terminal: TERMINAL });
    await expect(f.host.drainConversation(BINDING.identity.conversation_id)).rejects.toThrow(
      'failed to persist 1 command card settlement(s) during conversation drain',
    );
  });

  it.each(['action_conflict', 'incompatible_state'] as const)(
    '%s 消费旧 ticket 后为仍活动的同一 execution 重签，可再次取消',
    async (rejectionCode) => {
      const f = fixture();
      f.cancelAndWait.mockResolvedValueOnce({ status: 'rejected', code: rejectionCode });
      f.publish({ type: 'handle_published', binding: BINDING });
      const page = await f.host.openRendererPage(9, BINDING.identity.conversation_id);
      if (!page) throw new Error('page unavailable');
      await expect(f.host.cancel({
        ownerId: 9,
        submission: {
          page_ticket: page.page_ticket,
          control_ticket: firstCapability(page).control_ticket,
        },
      })).resolves.toEqual({ status: 'failed', code: rejectionCode });
      const retry = await f.host.readRendererPage({ ownerId: 9, pageTicket: page.page_ticket });
      if (!retry) throw new Error('retry snapshot unavailable');
      expect(firstCapability(retry).control_ticket).not.toBe(firstCapability(page).control_ticket);
      await expect(f.host.cancel({
        ownerId: 9,
        submission: {
          page_ticket: page.page_ticket,
          control_ticket: firstCapability(retry).control_ticket,
        },
      })).resolves.toMatchObject({ status: 'settled' });
    },
  );

  it('owner end 前重试 durable terminal，正式日志保留原异常且解绑后允许新 runtime', async () => {
    const persistenceError = new Error('stable injected persistence failure');
    const reportPersistenceFailure = vi.fn();
    const f = fixture({ failPersistence: true, persistenceError, reportPersistenceFailure });
    f.publish({ type: 'handle_published', binding: BINDING });
    const page = await f.host.openRendererPage(10, BINDING.identity.conversation_id);
    if (!page) throw new Error('page unavailable');
    f.publish({ type: 'terminal_settled', binding: BINDING, startedAtMs: 100, terminal: TERMINAL });

    await expect(f.host.drainConversation(BINDING.identity.conversation_id)).rejects.toThrow(
      'failed to persist 1 command card settlement(s) during conversation drain',
    );
    const failedProjection = await f.host.readRendererPage({
      ownerId: 10,
      pageTicket: page.page_ticket,
    });
    expect(failedProjection?.settlement_failures).toEqual([BINDING.process_handle]);
    expect(reportPersistenceFailure).toHaveBeenCalledWith({
      conversationId: BINDING.identity.conversation_id,
      processHandle: BINDING.process_handle,
      error: persistenceError,
    });

    let endError: unknown;
    try {
      await f.host.endAndDrain();
    } catch (error: unknown) {
      endError = error;
    }
    expect(endError).toEqual(new Error(
      'failed to persist 1 command card settlement(s) during owner end',
    ));
    expect(() => f.host.bindRuntime(f.runtime)).not.toThrow();
    await f.host.endAndDrain();
  });
});
