import type {
  CommandConversationId,
  CommandExecutionOwnerBindingV1,
  CommandExecutionTerminalV1,
  CommandProcessHandle,
  ProcessControlRequestV1,
} from '@app/schemas/commands';
import {
  COMMAND_TERMINAL_REPLAY_MAXIMUM_COUNT,
  COMMAND_TERMINAL_REPLAY_RETENTION_MS,
  hasSameCommandExecutionOwnerBinding,
  type CommandProcessOutputObservationPort,
  type CommandSettledTextOutput,
} from '../../../../../../domains/commands';

export interface LocalCommandTerminalReplay {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly outputObservation: CommandProcessOutputObservationPort;
  readonly settledTextOutput: Promise<CommandSettledTextOutput>;
  readonly startedAtMs: number;
  readonly terminal: CommandExecutionTerminalV1;
}

export type PendingTerminalReplayTakeResult =
  | { readonly status: 'taken'; readonly replay: LocalCommandTerminalReplay }
  | { readonly status: 'scope_mismatch' }
  | { readonly status: 'missing' };

export type LocalCommandTerminalReplayLookupResult =
  | { readonly status: 'published'; readonly replay: LocalCommandTerminalReplay }
  | { readonly status: 'expired'; readonly binding: CommandExecutionOwnerBindingV1 }
  | { readonly status: 'missing' };

interface RetainedTerminalReplay {
  readonly replay: LocalCommandTerminalReplay;
  readonly retainedAtMs: number;
}

interface ExpiredProcessHandle {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly expiresAtMs: number;
}

function firstValue<T>(values: ReadonlySet<T>): T | undefined {
  for (const value of values) return value;
  return undefined;
}

/**
 * 已结束 handle 与活动 execution 分开保存。这里不接触 runtime 或平台资源；按 scope
 * 分桶是为了让 opaque handle 的解析从 conversation/Agent run owner 内开始。
 */
export function createLocalCommandTerminalReplayRegistry(input: {
  readonly now?: () => number;
} = {}) {
  const now = input.now ?? Date.now;
  const pendingByExecutionId = new Map<string, LocalCommandTerminalReplay>();
  const publishedByScope = new Map<
    string,
    Map<CommandProcessHandle, RetainedTerminalReplay>
  >();
  const publishedOrder = new Set<RetainedTerminalReplay>();
  const expiredByScope = new Map<
    string,
    Map<CommandProcessHandle, ExpiredProcessHandle>
  >();
  const expiredOrder = new Set<ExpiredProcessHandle>();
  let pruneTimer: NodeJS.Timeout | undefined;

  function scopeKey(scope: {
    readonly conversation_id: string;
    readonly agent_run_id: string;
    readonly owner_generation_id: string;
  }): string {
    return JSON.stringify([
      scope.conversation_id,
      scope.agent_run_id,
      scope.owner_generation_id,
    ]);
  }

  function removePublished(retained: RetainedTerminalReplay): void {
    const key = scopeKey(retained.replay.binding.identity);
    const scopedReplays = publishedByScope.get(key);
    if (scopedReplays?.get(retained.replay.binding.process_handle) !== retained) return;
    scopedReplays.delete(retained.replay.binding.process_handle);
    if (scopedReplays.size === 0) publishedByScope.delete(key);
    publishedOrder.delete(retained);
  }

  function removeExpired(expired: ExpiredProcessHandle): void {
    const key = scopeKey(expired.binding.identity);
    const scopedHandles = expiredByScope.get(key);
    if (scopedHandles?.get(expired.binding.process_handle) !== expired) return;
    scopedHandles.delete(expired.binding.process_handle);
    if (scopedHandles.size === 0) expiredByScope.delete(key);
    expiredOrder.delete(expired);
  }

  function rememberExpired(
    binding: CommandExecutionOwnerBindingV1,
    expiredAtMs: number,
  ): void {
    const key = scopeKey(binding.identity);
    const scopedHandles = expiredByScope.get(key)
      ?? new Map<CommandProcessHandle, ExpiredProcessHandle>();
    const existing = scopedHandles.get(binding.process_handle);
    if (existing) removeExpired(existing);
    const expired = Object.freeze({
      binding,
      expiresAtMs: expiredAtMs + COMMAND_TERMINAL_REPLAY_RETENTION_MS,
    });
    scopedHandles.set(binding.process_handle, expired);
    expiredByScope.set(key, scopedHandles);
    expiredOrder.add(expired);
    while (expiredOrder.size > COMMAND_TERMINAL_REPLAY_MAXIMUM_COUNT) {
      const oldest = firstValue(expiredOrder);
      if (!oldest) break;
      removeExpired(oldest);
    }
  }

  function expirePublished(retained: RetainedTerminalReplay, expiredAtMs: number): void {
    removePublished(retained);
    rememberExpired(retained.replay.binding, expiredAtMs);
  }

  function pruneAt(currentTimeMs: number): void {
    for (const retained of publishedOrder) {
      if (
        retained.retainedAtMs + COMMAND_TERMINAL_REPLAY_RETENTION_MS
        > currentTimeMs
      ) break;
      expirePublished(retained, currentTimeMs);
    }
    for (const expired of expiredOrder) {
      if (expired.expiresAtMs > currentTimeMs) break;
      removeExpired(expired);
    }
  }

  function schedulePrune(): void {
    if (pruneTimer) clearTimeout(pruneTimer);
    pruneTimer = undefined;
    const firstPublished = firstValue(publishedOrder);
    const firstExpired = firstValue(expiredOrder);
    const deadlines = [
      firstPublished
        ? firstPublished.retainedAtMs + COMMAND_TERMINAL_REPLAY_RETENTION_MS
        : undefined,
      firstExpired?.expiresAtMs,
    ].filter((value): value is number => value !== undefined);
    if (deadlines.length === 0) return;
    const delayMs = Math.max(0, Math.min(...deadlines) - now());
    pruneTimer = setTimeout(() => {
      pruneTimer = undefined;
      pruneAt(now());
      schedulePrune();
    }, delayMs);
    pruneTimer.unref();
  }

  function pruneNow(): void {
    pruneAt(now());
    schedulePrune();
  }

  function findPublishedForBinding(
    binding: CommandExecutionOwnerBindingV1,
  ): LocalCommandTerminalReplay | undefined {
    pruneNow();
    return publishedByScope
      .get(scopeKey(binding.identity))
      ?.get(binding.process_handle)
      ?.replay;
  }

  function takePending(
    binding: CommandExecutionOwnerBindingV1,
  ): PendingTerminalReplayTakeResult {
    const pending = pendingByExecutionId.get(binding.identity.command_execution_id);
    if (!pending) return { status: 'missing' };
    if (!hasSameCommandExecutionOwnerBinding(pending.binding, binding)) {
      return { status: 'scope_mismatch' };
    }
    pendingByExecutionId.delete(binding.identity.command_execution_id);
    return { status: 'taken', replay: pending };
  }

  return Object.freeze({
    lookup(request: ProcessControlRequestV1): LocalCommandTerminalReplayLookupResult {
      pruneNow();
      const key = scopeKey(request.scope);
      const published = publishedByScope.get(key)?.get(request.process_handle);
      if (published) return { status: 'published', replay: published.replay };
      const expired = expiredByScope.get(key)?.get(request.process_handle);
      return expired
        ? { status: 'expired', binding: expired.binding }
        : { status: 'missing' };
    },

    findPublishedForBinding,

    rememberPublished(replay: LocalCommandTerminalReplay): void {
      const currentTimeMs = now();
      pruneAt(currentTimeMs);
      const key = scopeKey(replay.binding.identity);
      const scopedReplays = publishedByScope.get(key)
        ?? new Map<CommandProcessHandle, RetainedTerminalReplay>();
      const existing = scopedReplays.get(replay.binding.process_handle);
      if (existing) removePublished(existing);
      const expired = expiredByScope.get(key)?.get(replay.binding.process_handle);
      if (expired) removeExpired(expired);
      const retained = Object.freeze({ replay, retainedAtMs: currentTimeMs });
      scopedReplays.set(replay.binding.process_handle, retained);
      publishedByScope.set(key, scopedReplays);
      publishedOrder.add(retained);
      while (publishedOrder.size > COMMAND_TERMINAL_REPLAY_MAXIMUM_COUNT) {
        const oldest = firstValue(publishedOrder);
        if (!oldest) break;
        expirePublished(oldest, currentTimeMs);
      }
      schedulePrune();
    },

    stagePending(replay: LocalCommandTerminalReplay): void {
      pendingByExecutionId.set(replay.binding.identity.command_execution_id, replay);
    },

    takePending,

    discardPending(binding: CommandExecutionOwnerBindingV1): boolean {
      const result = takePending(binding);
      return result.status === 'taken';
    },

    forgetConversation(conversationId: CommandConversationId): void {
      for (const retained of [...publishedOrder]) {
        if (retained.replay.binding.identity.conversation_id === conversationId) {
          removePublished(retained);
        }
      }
      for (const expired of [...expiredOrder]) {
        if (expired.binding.identity.conversation_id === conversationId) {
          removeExpired(expired);
        }
      }
      for (const [executionId, pending] of pendingByExecutionId) {
        if (pending.binding.identity.conversation_id === conversationId) {
          pendingByExecutionId.delete(executionId);
        }
      }
      schedulePrune();
    },

    clear(): void {
      if (pruneTimer) clearTimeout(pruneTimer);
      pruneTimer = undefined;
      pendingByExecutionId.clear();
      publishedByScope.clear();
      publishedOrder.clear();
      expiredByScope.clear();
      expiredOrder.clear();
    },

    readSnapshot() {
      pruneNow();
      return Object.freeze({
        pendingCount: pendingByExecutionId.size,
        publishedCount: publishedOrder.size,
        expiredCount: expiredOrder.size,
      });
    },
  });
}
