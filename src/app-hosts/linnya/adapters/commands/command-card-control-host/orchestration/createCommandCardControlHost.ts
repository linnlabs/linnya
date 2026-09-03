import { randomUUID } from 'node:crypto';
import {
  CommandCardControlPageSnapshotV1Schema,
  CommandCardControlPageTicketSchema,
  CommandCardControlTicketSchema,
  CommandControlToolCallIdSchema,
  CommandProtectedInputTicketSchema,
  hasSameCommandExecutionIdentity,
  type CommandCardCancelResultV1,
  type CommandCardControlPageTicket,
  type CommandCardControlTicket,
  type CommandProtectedInputResultV1,
  type CommandProtectedInputTicket,
  type CommandExecutionOwnerBindingV1,
  type CommandExecutionTerminalV1,
  type CommandProcessHandle,
} from '@app/schemas/commands';
import type {
  CommandCardSettlementPort,
  CommandExecutionLifecycleEvent,
  CommandExecutionLifecycleObservationPort,
  CommandProcessControlPort,
  ProcessCancellationRequestV1,
} from 'src/domains/commands';
import type { CommandExecutionAuditPort } from 'src/domains/audit/features/command-execution-audit';
import type { CommandCardControlHost } from '../definitions/commandCardControlHost';

interface BoundRuntime {
  readonly control: CommandProcessControlPort;
  readonly lifecycle: CommandExecutionLifecycleObservationPort;
  readonly settlements: CommandCardSettlementPort;
  readonly audit: CommandExecutionAuditPort;
}

interface RendererPage {
  readonly pageTicket: CommandCardControlPageTicket;
  readonly conversationId: string;
}

interface ControlCapability {
  readonly pageTicket: CommandCardControlPageTicket;
  readonly binding: CommandExecutionOwnerBindingV1;
}

interface ProtectedInputCapability {
  readonly pageTicket: CommandCardControlPageTicket;
  readonly binding: CommandExecutionOwnerBindingV1;
}

interface ProtectedInputOperation {
  readonly conversationId: string;
  readonly settled: Promise<void>;
}

interface FailedSettlementWrite {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly startedAtMs: number;
  readonly terminal: CommandExecutionTerminalV1;
}

function executionKey(binding: CommandExecutionOwnerBindingV1): string {
  return `${binding.identity.command_execution_id}\u0000${binding.process_handle}`;
}

export function createCommandCardControlHost(input: {
  readonly createUuid?: () => string;
  readonly now?: () => number;
  readonly reportPersistenceFailure?: (context: {
    readonly conversationId: string;
    readonly processHandle: string;
    readonly error: unknown;
  }) => void;
} = {}): CommandCardControlHost {
  const createUuid = input.createUuid ?? randomUUID;
  const now = input.now ?? Date.now;
  const active = new Map<string, CommandExecutionOwnerBindingV1>();
  const pages = new Map<number, RendererPage>();
  const capabilities = new Map<CommandCardControlTicket, ControlCapability>();
  const protectedInputCapabilities = new Map<
    CommandProtectedInputTicket,
    ProtectedInputCapability
  >();
  const protectedInputOperations = new Map<string, ProtectedInputOperation>();
  const listeners = new Set<() => void>();
  const persistenceByExecution = new Map<string, Promise<CommandCardCancelResultV1>>();
  const settlementFailures = new Map<string, string>();
  const auditFailures = new Map<CommandProcessHandle, CommandExecutionOwnerBindingV1>();
  const failedWrites = new Map<string, FailedSettlementWrite>();
  const failedAuditStatusWrites = new Map<string, CommandExecutionOwnerBindingV1>();
  let runtime: BoundRuntime | undefined;
  let unsubscribeLifecycle: (() => void) | undefined;
  let persistenceTail: Promise<void> = Promise.resolve();

  const reportPersistenceFailure = (context: {
    readonly conversationId: string;
    readonly processHandle: string;
    readonly error: unknown;
  }): void => {
    try {
      input.reportPersistenceFailure?.(context);
    } catch {
      // 诊断出口也是观察者；它失效时不能让 durable terminal waiter 永久不结算。
    }
  };

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // renderer 信号只是观察者；坏页面不能阻断其他页面或 durable terminal 队列。
        continue;
      }
    }
  };

  const hasAuditFailure = (binding: CommandExecutionOwnerBindingV1): boolean => {
    const failed = auditFailures.get(binding.process_handle);
    return Boolean(
      failed
      && hasSameCommandExecutionIdentity(failed.identity, binding.identity),
    );
  };

  const enqueueAuditIncomplete = (binding: CommandExecutionOwnerBindingV1): void => {
    const bound = runtime;
    if (!bound) return;
    const key = executionKey(binding);
    persistenceTail = persistenceTail.then(async () => {
      try {
        const marked = await bound.settlements.markAuditIncomplete(binding);
        if (marked.status === 'conflict') {
          reportPersistenceFailure({
            conversationId: binding.identity.conversation_id,
            processHandle: binding.process_handle,
            error: new Error('command card audit status conflicts with an existing binding'),
          });
          failedAuditStatusWrites.set(key, binding);
        } else {
          // terminal 尚未落盘不是失败；后续 recordTerminal 会读取同一内存事实。
          failedAuditStatusWrites.delete(key);
        }
      } catch (error: unknown) {
        reportPersistenceFailure({
          conversationId: binding.identity.conversation_id,
          processHandle: binding.process_handle,
          error,
        });
        failedAuditStatusWrites.set(key, binding);
      } finally {
        notify();
      }
    });
    // 写失败由 failedAuditStatusWrites 留给 drain 重试，不能让队列永久拒绝。
    persistenceTail = persistenceTail.catch(() => undefined);
  };

  const rememberAuditFailure = (binding: CommandExecutionOwnerBindingV1): void => {
    const existing = auditFailures.get(binding.process_handle);
    if (
      existing
      && hasSameCommandExecutionIdentity(existing.identity, binding.identity)
    ) return;
    // 审计失败属于当前 command owner，而不是 renderer 页；切页后返回仍需看见警告。
    auditFailures.set(binding.process_handle, binding);
    // terminal 卡片可能已经先于后台审计失败落盘。复用 sidecar 的窄降级接口，
    // 只把 complete 单向改成 incomplete，不改写 owner 终态或 Agent 结果。
    enqueueAuditIncomplete(binding);
    notify();
  };

  const revokeConversation = (conversationId: string, forgetAuditFailures = false): void => {
    for (const [handle, binding] of active) {
      if (binding.identity.conversation_id === conversationId) active.delete(handle);
    }
    for (const [ticket, capability] of capabilities) {
      if (capability.binding.identity.conversation_id === conversationId) capabilities.delete(ticket);
    }
    for (const [ticket, capability] of protectedInputCapabilities) {
      if (capability.binding.identity.conversation_id === conversationId) {
        protectedInputCapabilities.delete(ticket);
      }
    }
    if (forgetAuditFailures) {
      for (const [handle, failedBinding] of auditFailures) {
        if (failedBinding.identity.conversation_id === conversationId) auditFailures.delete(handle);
      }
    }
    notify();
  };

  const enqueueTerminal = (
    binding: CommandExecutionOwnerBindingV1,
    startedAtMs: number,
    terminal: CommandExecutionTerminalV1,
  ): Promise<CommandCardCancelResultV1> => {
    const key = executionKey(binding);
    const existing = persistenceByExecution.get(key);
    if (existing) return existing;
    const bound = runtime;
    if (!bound) return Promise.resolve({ status: 'failed', code: 'owner_unavailable' });
    let resolveResult!: (result: CommandCardCancelResultV1) => void;
    const result = new Promise<CommandCardCancelResultV1>(resolve => { resolveResult = resolve; });
    persistenceByExecution.set(key, result);
    persistenceTail = persistenceTail.then(async () => {
      try {
        const auditStatus = hasAuditFailure(binding) ? 'incomplete' : 'complete';
        const recorded = await bound.settlements.recordTerminal({
          binding,
          startedAtMs,
          auditStatus,
          terminal,
        });
        if (recorded.status === 'conflict') {
          const error = new Error('command card settlement conflicts with an existing binding');
          reportPersistenceFailure({
            conversationId: binding.identity.conversation_id,
            processHandle: binding.process_handle,
            error,
          });
          settlementFailures.set(binding.process_handle, binding.identity.conversation_id);
          failedWrites.set(key, { binding, startedAtMs, terminal });
          resolveResult({ status: 'failed', code: 'persistence_failed' });
        } else {
          settlementFailures.delete(binding.process_handle);
          failedWrites.delete(key);
          if (auditStatus === 'incomplete') failedAuditStatusWrites.delete(key);
          resolveResult({ status: 'settled', settlement: recorded.settlement });
        }
      } catch (error: unknown) {
        reportPersistenceFailure({
          conversationId: binding.identity.conversation_id,
          processHandle: binding.process_handle,
          error,
        });
        settlementFailures.set(binding.process_handle, binding.identity.conversation_id);
        failedWrites.set(key, { binding, startedAtMs, terminal });
        resolveResult({ status: 'failed', code: 'persistence_failed' });
      } finally {
        persistenceByExecution.delete(key);
        notify();
      }
    });
    // queue tail 永远吸收单项失败，保证后续 execution 仍能落盘；失败事实由 result 返回。
    persistenceTail = persistenceTail.catch(() => undefined);
    return result;
  };

  const observeLifecycle = (event: CommandExecutionLifecycleEvent): void => {
    if (event.type === 'handle_published') {
      active.set(event.binding.process_handle, event.binding);
      notify();
      return;
    }
    if (event.type === 'terminal_settled') {
      active.delete(event.binding.process_handle);
      for (const [ticket, capability] of capabilities) {
        if (executionKey(capability.binding) === executionKey(event.binding)) capabilities.delete(ticket);
      }
      for (const [ticket, capability] of protectedInputCapabilities) {
        if (executionKey(capability.binding) === executionKey(event.binding)) {
          protectedInputCapabilities.delete(ticket);
        }
      }
      void enqueueTerminal(event.binding, event.startedAtMs, event.terminal);
      notify();
      return;
    }
    if (event.type === 'conversation_stopping' || event.type === 'conversation_forgotten') {
      // stopping 只撤销控制能力；真正删除对话时才遗忘该对话的审计警告。
      revokeConversation(event.conversationId, event.type === 'conversation_forgotten');
      return;
    }
    active.clear();
    capabilities.clear();
    protectedInputCapabilities.clear();
    pages.clear();
    // owner_ending 后仍会依次到达 terminal settlement 与后台审计 drain。
    // 过早清空会把已知的 started 审计失败错误落成 complete；统一在 endAndDrain 清理。
    notify();
  };

  const projectPage = async (page: RendererPage) => {
    const bound = runtime;
    if (!bound) return undefined;
    const projectedCapabilities = Array.from(active.values())
      .filter(binding => binding.identity.conversation_id === page.conversationId)
      .map((binding) => {
        const existing = Array.from(capabilities.entries()).find(([, capability]) => (
          capability.pageTicket === page.pageTicket
          && executionKey(capability.binding) === executionKey(binding)
        ));
        const controlTicket = existing?.[0] ?? CommandCardControlTicketSchema.parse(
          `command_control_ticket_${createUuid()}`,
        );
        if (!existing) capabilities.set(controlTicket, { pageTicket: page.pageTicket, binding });
        const protectedInputExisting = binding.mode === 'pty'
          ? Array.from(protectedInputCapabilities.entries()).find(([, capability]) => (
              capability.pageTicket === page.pageTicket
              && executionKey(capability.binding) === executionKey(binding)
            ))
          : undefined;
        const protectedInputTicket = binding.mode === 'pty'
          ? protectedInputExisting?.[0] ?? CommandProtectedInputTicketSchema.parse(
              `command_protected_input_ticket_${createUuid()}`,
            )
          : undefined;
        if (protectedInputTicket && !protectedInputExisting) {
          protectedInputCapabilities.set(protectedInputTicket, {
            pageTicket: page.pageTicket,
            binding,
          });
        }
        return {
          protocol_version: 1 as const,
          kind: 'command_card_control_capability' as const,
          process_handle: binding.process_handle,
          control_ticket: controlTicket,
          ...(protectedInputTicket ? { protected_input_ticket: protectedInputTicket } : {}),
        };
      });
    return CommandCardControlPageSnapshotV1Schema.parse({
      protocol_version: 1,
      kind: 'command_card_control_page_snapshot',
      page_ticket: page.pageTicket,
      conversation_id: page.conversationId,
      capabilities: projectedCapabilities,
      settlements: await bound.settlements.listForConversation(page.conversationId),
      settlement_failures: Array.from(settlementFailures.entries()).flatMap(
        ([handle, conversationId]) => conversationId === page.conversationId && !active.has(handle)
          ? [handle]
          : [],
      ),
      audit_failures: Array.from(auditFailures.values()).flatMap(
        binding => binding.identity.conversation_id === page.conversationId
          ? [binding.process_handle]
          : [],
      ),
    });
  };

  const host: CommandCardControlHost = {
    bindRuntime(next) {
      if (runtime) throw new Error('command card control runtime is already bound');
      unsubscribeLifecycle?.();
      runtime = next;
      active.clear();
      capabilities.clear();
      protectedInputCapabilities.clear();
      protectedInputOperations.clear();
      pages.clear();
      persistenceByExecution.clear();
      settlementFailures.clear();
      auditFailures.clear();
      failedWrites.clear();
      failedAuditStatusWrites.clear();
      persistenceTail = Promise.resolve();
      unsubscribeLifecycle = next.lifecycle.subscribeExecutionLifecycle(observeLifecycle);
    },

    async openRendererPage(ownerId, conversationId) {
      if (!runtime) return undefined;
      const previous = pages.get(ownerId);
      if (previous) {
        for (const [ticket, capability] of capabilities) {
          if (capability.pageTicket === previous.pageTicket) capabilities.delete(ticket);
        }
        for (const [ticket, capability] of protectedInputCapabilities) {
          if (capability.pageTicket === previous.pageTicket) {
            protectedInputCapabilities.delete(ticket);
          }
        }
      }
      const page = {
        pageTicket: CommandCardControlPageTicketSchema.parse(`command_control_page_${createUuid()}`),
        conversationId,
      };
      pages.set(ownerId, page);
      return projectPage(page);
    },

    async readRendererPage({ ownerId, pageTicket }) {
      const page = pages.get(ownerId);
      if (!page || page.pageTicket !== pageTicket) return undefined;
      return projectPage(page);
    },

    invalidateRendererPage({ ownerId, pageTicket }) {
      const page = pages.get(ownerId);
      if (!page || page.pageTicket !== pageTicket) return;
      pages.delete(ownerId);
      for (const [ticket, capability] of capabilities) {
        if (capability.pageTicket === pageTicket) capabilities.delete(ticket);
      }
      for (const [ticket, capability] of protectedInputCapabilities) {
        if (capability.pageTicket === pageTicket) protectedInputCapabilities.delete(ticket);
      }
    },

    reportAuditFailure({ binding }) {
      if (!runtime) return;
      rememberAuditFailure(binding);
    },

    hasAuditFailure(binding) {
      return hasAuditFailure(binding);
    },

    async cancel({ ownerId, submission }) {
      const bound = runtime;
      const page = pages.get(ownerId);
      const capability = capabilities.get(submission.control_ticket);
      if (
        !bound
        || !page
        || page.pageTicket !== submission.page_ticket
        || capability?.pageTicket !== submission.page_ticket
      ) return { status: 'stale' };
      if (!capability) return { status: 'stale' };
      capabilities.delete(submission.control_ticket);
      const binding = capability.binding;
      const controlRequest: ProcessCancellationRequestV1 = {
        protocol_version: 1,
        kind: 'process_control_request',
        process_handle: binding.process_handle,
        scope: {
          conversation_id: binding.identity.conversation_id,
          agent_run_id: binding.identity.agent_run_id,
          control_tool_call_id: CommandControlToolCallIdSchema.parse(
            `command_card_control_${createUuid()}`,
          ),
          owner_generation_id: binding.identity.owner_generation_id,
        },
        action: { type: 'cancel' },
      };
      const cancelled = await bound.control.cancelAndWait(controlRequest);
      if (cancelled.status === 'rejected') {
        const allowed = ['incompatible_state', 'owner_ending', 'owner_ended', 'action_conflict'] as const;
        const code = allowed.find(value => value === cancelled.code) ?? 'incompatible_state';
        const current = active.get(binding.process_handle);
        if (
          current
          && executionKey(current) === executionKey(binding)
          && (code === 'incompatible_state' || code === 'action_conflict')
        ) notify();
        return { status: 'failed', code };
      }
      active.delete(binding.process_handle);
      for (const [ticket, current] of capabilities) {
        if (executionKey(current.binding) === executionKey(binding)) capabilities.delete(ticket);
      }
      return enqueueTerminal(binding, cancelled.startedAtMs, cancelled.terminal);
    },

    submitProtectedInput({ ownerId, submission }) {
      const bound = runtime;
      const page = pages.get(ownerId);
      const capability = protectedInputCapabilities.get(submission.protected_input_ticket);
      if (
        !bound
        || !page
        || page.pageTicket !== submission.page_ticket
        || capability?.pageTicket !== submission.page_ticket
      ) return Promise.resolve({ status: 'stale' });
      if (!capability) return Promise.resolve({ status: 'stale' });

      // 票据消费是同步线性化点，必须位于第一次 await 之前。同一 renderer 即使并发
      // 重放相同 payload，也只有当前调用能取得 binding 并触达 PTY。
      protectedInputCapabilities.delete(submission.protected_input_ticket);
      const binding = capability.binding;
      const attemptId = `command_protected_input_${createUuid()}`;
      const inputBytes = new TextEncoder().encode(submission.input).byteLength;
      const occurredAtMs = now();
      notify();

      const operation = (async (): Promise<CommandProtectedInputResultV1> => {
        const controlled = await bound.control.submitProtectedInput({
          binding,
          input: submission.input,
        });
        try {
          await bound.audit.record({
            kind: 'protected_input',
            occurred_at_ms: occurredAtMs,
            identity: binding.identity,
            process_handle: binding.process_handle,
            attempt_id: attemptId,
            input_bytes: inputBytes,
            result: controlled,
          });
        } catch {
          // 审计失败不能重放秘密输入；沿用卡片 audit_status 的单向降级事实。
          rememberAuditFailure(binding);
        }
        if (controlled.status === 'accepted') return { status: 'accepted' };
        const exposedCodes = [
          'incompatible_state',
          'owner_ending',
          'owner_ended',
          'stdin_closed',
          'interaction_failed',
        ] as const;
        return {
          status: 'failed',
          code: exposedCodes.find(code => code === controlled.code) ?? 'incompatible_state',
        };
      })();
      const settled = operation.then(() => undefined, () => undefined).finally(() => {
        protectedInputOperations.delete(attemptId);
        notify();
      });
      protectedInputOperations.set(attemptId, {
        conversationId: binding.identity.conversation_id,
        settled,
      });
      return operation;
    },

    async drainProtectedInputs() {
      while (protectedInputOperations.size > 0) {
        await Promise.all(Array.from(protectedInputOperations.values()).map(value => value.settled));
      }
    },

    async drainConversation(conversationId) {
      if (!runtime) throw new Error('command card control runtime is not bound');
      await Promise.all(Array.from(protectedInputOperations.values())
        .filter(value => value.conversationId === conversationId)
        .map(value => value.settled));
      const waits = Array.from(active.values())
        .filter(binding => binding.identity.conversation_id === conversationId)
        .map(binding => persistenceByExecution.get(executionKey(binding)))
        .filter((value): value is Promise<CommandCardCancelResultV1> => value !== undefined);
      await Promise.all(waits);
      await persistenceTail;
      const failed = Array.from(failedWrites.values()).filter(
        value => value.binding.identity.conversation_id === conversationId,
      );
      await Promise.all(failed.map(value => enqueueTerminal(
        value.binding,
        value.startedAtMs,
        value.terminal,
      )));
      for (const binding of Array.from(failedAuditStatusWrites.values()).filter(
        value => value.identity.conversation_id === conversationId,
      )) enqueueAuditIncomplete(binding);
      await persistenceTail;
      const remaining = Array.from(failedWrites.values()).filter(
        value => value.binding.identity.conversation_id === conversationId,
      );
      if (remaining.length > 0) {
        throw new Error(
          `failed to persist ${remaining.length} command card settlement(s) during conversation drain`,
        );
      }
      const remainingAuditStatuses = Array.from(failedAuditStatusWrites.values()).filter(
        binding => binding.identity.conversation_id === conversationId,
      );
      if (remainingAuditStatuses.length > 0) {
        throw new Error(
          `failed to persist ${remainingAuditStatuses.length} command card audit status write(s) during conversation drain`,
        );
      }
    },

    async deleteConversationSettlements(conversationId) {
      const bound = runtime;
      if (!bound) throw new Error('command card control runtime is not bound');
      await persistenceTail;
      await bound.settlements.deleteForConversation(conversationId);
      for (const [handle, failedBinding] of auditFailures) {
        if (failedBinding.identity.conversation_id === conversationId) auditFailures.delete(handle);
      }
      for (const [key, failedBinding] of failedAuditStatusWrites) {
        if (failedBinding.identity.conversation_id === conversationId) failedAuditStatusWrites.delete(key);
      }
      notify();
    },

    async endAndDrain() {
      await host.drainProtectedInputs();
      await persistenceTail;
      const failed = Array.from(failedWrites.values());
      await Promise.all(failed.map(value => enqueueTerminal(
        value.binding,
        value.startedAtMs,
        value.terminal,
      )));
      for (const binding of failedAuditStatusWrites.values()) enqueueAuditIncomplete(binding);
      await persistenceTail;
      const remainingFailureCount = failedWrites.size;
      const remainingAuditStatusFailureCount = failedAuditStatusWrites.size;
      unsubscribeLifecycle?.();
      unsubscribeLifecycle = undefined;
      runtime = undefined;
      active.clear();
      capabilities.clear();
      protectedInputCapabilities.clear();
      protectedInputOperations.clear();
      pages.clear();
      persistenceByExecution.clear();
      settlementFailures.clear();
      auditFailures.clear();
      failedWrites.clear();
      failedAuditStatusWrites.clear();
      if (remainingFailureCount > 0) {
        throw new Error(
          `failed to persist ${remainingFailureCount} command card settlement(s) during owner end`,
        );
      }
      if (remainingAuditStatusFailureCount > 0) {
        throw new Error(
          `failed to persist ${remainingAuditStatusFailureCount} command card audit status write(s) during owner end`,
        );
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return Object.freeze(host);
}
