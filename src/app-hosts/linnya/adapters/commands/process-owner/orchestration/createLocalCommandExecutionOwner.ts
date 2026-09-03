import { randomUUID } from 'node:crypto';

import {
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  hasSameCommandExecutionIdentity,
  parseCommandExecutionOwnerBinding,
  type CommandAgentRunId,
  type CommandConversationId,
  type CommandExecutionOwnerBindingV1,
  type CommandExecutionTerminalV1,
  type CommandOwnerGenerationId,
  type CommandProcessHandle,
  type ProcessControlRequestV1,
} from '@app/schemas/commands';
import {
  acceptCommandExecutionReservation,
  acceptCommandExecutionStart,
  acceptProcessAction,
  advanceProcessTerminalState,
  createOwnerEndedBeforeStartTerminal,
  doesInteractionCapabilityMatchExecutionMode,
  evaluateCommandExecutionStopRelease,
  hasExplicitCommandExecutionReleaseFailure,
  hasSameCommandExecutionOwnerBinding,
  isProcessOutputQueryRequest,
  type CommandExecutionActivityState,
  type CommandExecutionLifecycleEvent,
  type CommandExecutionLifecycleObservationPort,
  type CommandExecutionOwnerPort,
  type CommandProcessCancellationResult,
  type CommandProcessControlPort,
  type CommandProcessObservationPort,
  type CommandProcessOutputQueryResult,
  type CommandExecutionRuntimeControl,
  type CommandExecutionRuntimeStopCause,
  type CommandExecutionPreparedRuntimeStartResult,
  type PreparedCommandExecutionRuntime,
  type ProcessCancellationRequestV1,
  type ProcessOwnerLifecycle,
  COMMAND_MAXIMUM_ACTIVE_EXECUTIONS,
} from '../../../../../../domains/commands';
import type { LocalCommandExecutionEntry } from '../definitions/localCommandExecutionEntry';
import { LocalCommandExecutionOwnerError } from '../definitions/localCommandExecutionOwnerError';
import { createLocalCommandExecutionEntry } from '../functions/createLocalCommandExecutionEntry';
import {
  createLocalCommandTerminalReplayRegistry,
  type LocalCommandTerminalReplay,
} from '../functions/createLocalCommandTerminalReplayRegistry';
import { resolveLocalCommandProcessTarget } from '../functions/resolveLocalCommandProcessTarget';
import { controlLocalCommandProcessInteraction } from './controlLocalCommandProcessInteraction';
import { submitProtectedLocalCommandInput } from './submitProtectedLocalCommandInput';

export type LocalCommandOwnerPort = CommandExecutionOwnerPort
  & CommandProcessObservationPort
  & CommandProcessControlPort
  & CommandExecutionLifecycleObservationPort;

function defaultGenerationId(): CommandOwnerGenerationId {
  return CommandOwnerGenerationIdSchema.parse(`command_owner_${randomUUID()}`);
}

function defaultProcessHandle(): CommandProcessHandle {
  return CommandProcessHandleSchema.parse(`command_process_${randomUUID()}`);
}

/**
 * 每个 App command owner 创建一个实例。活动 execution 与无资源终态记录严格分开；
 * terminal replay 不持有 runtime/PID/pipe，并在 owner 结束或对话删除后失效。
 */
export function createLocalCommandExecutionOwner(input: {
  readonly generationId?: CommandOwnerGenerationId;
  readonly createProcessHandle?: () => CommandProcessHandle;
  readonly now?: () => number;
  readonly maximumActiveExecutions?: number;
} = {}): LocalCommandOwnerPort {
  const generationId = input.generationId ?? defaultGenerationId();
  const createProcessHandle = input.createProcessHandle ?? defaultProcessHandle;
  const now = input.now ?? Date.now;
  const maximumActiveExecutions = input.maximumActiveExecutions
    ?? COMMAND_MAXIMUM_ACTIVE_EXECUTIONS;
  if (!Number.isSafeInteger(maximumActiveExecutions) || maximumActiveExecutions <= 0) {
    throw new Error('maximumActiveExecutions must be a positive safe integer');
  }
  const entries = new Map<string, LocalCommandExecutionEntry>();
  const terminalReplays = createLocalCommandTerminalReplayRegistry({ now });
  const stoppingConversations = new Set<CommandConversationId>();
  const stoppingAgentRuns = new Set<string>();
  const lifecycleListeners = new Set<(event: CommandExecutionLifecycleEvent) => void>();
  let lifecycle: ProcessOwnerLifecycle = 'active';
  let endingPromise: Promise<void> | undefined;

  const ownerSnapshot = () => ({ generationId, lifecycle } as const);

  function publishLifecycleEvent(event: CommandExecutionLifecycleEvent): void {
    for (const listener of lifecycleListeners) {
      try {
        listener(event);
      } catch {
        // 观察者不拥有 terminal：单个投影 listener 的编程错误不能中断进程树释放。
        // 持久化 listener 只同步入队，真正 I/O 失败由其有界队列单独形成失败事实。
        continue;
      }
    }
  }

  function agentRunScopeKey(input: {
    readonly conversationId: CommandConversationId;
    readonly agentRunId: CommandAgentRunId;
  }): string {
    return `${input.conversationId.length}:${input.conversationId}${input.agentRunId}`;
  }

  function clearAgentRunTombstonesForConversation(
    conversationId: CommandConversationId,
  ): void {
    const scopePrefix = `${conversationId.length}:${conversationId}`;
    for (const key of stoppingAgentRuns) {
      if (key.startsWith(scopePrefix)) stoppingAgentRuns.delete(key);
    }
  }

  function findEntryInRequestScope(
    request: ProcessControlRequestV1,
  ): LocalCommandExecutionEntry | undefined {
    // App 活跃 run 本身有固定小上限。线性查找避免再维护一张会与 execution Map
    // 在 reservation、终态和删除竞态中失同步的可变索引；先限定 owner scope，
    // 再比较 opaque handle，避免把全局 handle 表当成跨对话存在性探针。
    return Array.from(entries.values()).find(entry => (
      entry.binding.identity.conversation_id === request.scope.conversation_id
      && entry.binding.identity.agent_run_id === request.scope.agent_run_id
      && entry.binding.identity.owner_generation_id === request.scope.owner_generation_id
      && entry.binding.process_handle === request.process_handle
    ));
  }

  function resolveProcessTarget(request: ProcessControlRequestV1): {
    readonly entry: LocalCommandExecutionEntry | undefined;
    readonly replay: LocalCommandTerminalReplay | undefined;
    readonly expiredBinding: CommandExecutionOwnerBindingV1 | undefined;
    readonly target: ReturnType<typeof resolveLocalCommandProcessTarget>;
  } {
    const entry = findEntryInRequestScope(request);
    const lookup = terminalReplays.lookup(request);
    const replay = lookup.status === 'published' ? lookup.replay : undefined;
    const expiredBinding = lookup.status === 'expired' ? lookup.binding : undefined;
    const target = resolveLocalCommandProcessTarget({ entry, replay, expiredBinding });
    return { entry, replay, expiredBinding, target };
  }

  function rememberTerminalReplay(
    entry: LocalCommandExecutionEntry,
    terminal: CommandExecutionTerminalV1,
  ): void {
    if (
      !entry.handlePublished
      || !entry.outputObservation
      || !entry.settledTextOutput
      || entry.startedAtMs === undefined
      || lifecycle !== 'active'
    ) return;
    terminalReplays.rememberPublished(Object.freeze({
      binding: entry.binding,
      outputObservation: entry.outputObservation,
      settledTextOutput: entry.settledTextOutput,
      startedAtMs: entry.startedAtMs,
      terminal,
    }));
  }

  function discardPendingHandleDecision(binding: CommandExecutionOwnerBindingV1): boolean {
    return terminalReplays.discardPending(binding);
  }

  function settleReleased(entry: LocalCommandExecutionEntry): void {
    if (entry.settlementPublished) return;
    if (entries.get(entry.binding.identity.command_execution_id) === entry) {
      entries.delete(entry.binding.identity.command_execution_id);
    }
    entry.settlementPublished = true;
    entry.runtime = undefined;
    entry.outputObservation = undefined;
    entry.settledTextOutput = undefined;
    entry.resolveSettlement(null);
  }

  function settleTerminal(
    entry: LocalCommandExecutionEntry,
    candidate: CommandExecutionTerminalV1,
  ): CommandExecutionTerminalV1 {
    const advanced = advanceProcessTerminalState({
      expectedIdentity: entry.binding.identity,
      currentTerminal: entry.terminal,
      candidate,
    });
    if (advanced.status === 'ignored') {
      if (advanced.reason === 'already_terminal' && advanced.terminal) {
        return advanced.terminal;
      }
      throw new LocalCommandExecutionOwnerError(
        `Command runtime returned an invalid terminal: ${advanced.reason}`,
        [candidate],
      );
    }

    entry.terminal = advanced.terminal;
    settleTerminalBarrierIfReady(entry);
    return advanced.terminal;
  }

  function settleTerminalBarrierIfReady(entry: LocalCommandExecutionEntry): void {
    if (entry.terminal && entry.startSettled && !entry.settlementPublished) {
      if (entry.stopCause || hasExplicitCommandExecutionReleaseFailure(entry.terminal)) {
        const release = evaluateCommandExecutionStopRelease(entry.terminal);
        if (release.status === 'blocked') {
          // 失败 terminal 仍要唤醒删除 waiter，但活动记录必须留下；否则目录可能在后代
          // 或文件句柄尚存时被删除。未来 runtime 只有从启动起归正式平台 owner 接管，
          // 并产出成功终态的新 execution，才能走下面的释放分支。
          entry.state = 'stopping';
          entry.settlementPublished = true;
          entry.resolveSettlement(entry.terminal);
          return;
        }
      }
      if (entries.get(entry.binding.identity.command_execution_id) === entry) {
        const terminalRecord: LocalCommandTerminalReplay | undefined = (
          entry.outputObservation && entry.settledTextOutput && entry.startedAtMs !== undefined
        )
          ? Object.freeze({
              binding: entry.binding,
              outputObservation: entry.outputObservation,
              settledTextOutput: entry.settledTextOutput,
              startedAtMs: entry.startedAtMs,
              terminal: entry.terminal,
            })
          : undefined;
        if (entry.handlePublished) {
          // 先发布 replay 再移除活动项，避免最后一次 poll 与 terminal 之间出现查无 handle 的空窗。
          rememberTerminalReplay(entry, entry.terminal);
          if (entry.startedAtMs !== undefined) {
            publishLifecycleEvent({
              type: 'terminal_settled',
              binding: entry.binding,
              startedAtMs: entry.startedAtMs,
              terminal: entry.terminal,
            });
          }
        } else if (terminalRecord) {
          // shell 初始等待与超快终态可能同时完成。先保留一个无资源决议记录，
          // 直到调用方明确 publish 或 discard，不能让刚准备返回的 handle 瞬间变 unknown。
          terminalReplays.stagePending(terminalRecord);
        }
        entries.delete(entry.binding.identity.command_execution_id);
      }
      entry.settlementPublished = true;
      entry.runtime = undefined;
      entry.outputObservation = undefined;
      entry.settledTextOutput = undefined;
      entry.resolveSettlement(entry.terminal);
    }
  }

  function settleReservedForOwnerEnd(entry: LocalCommandExecutionEntry): void {
    settleTerminal(entry, createOwnerEndedBeforeStartTerminal({
      identity: entry.binding.identity,
      settledAtMs: now(),
    }));
  }

  function observeRuntimeTerminal(
    entry: LocalCommandExecutionEntry,
    runtime: CommandExecutionRuntimeControl,
  ): Promise<CommandExecutionTerminalV1> {
    const observation = runtime.terminal.then(candidate => settleTerminal(entry, candidate));
    // 自然终态可能在没有 process poll waiter 时到达，owner 仍必须消费 rejection，
    // 避免宿主产生未处理 Promise；真正的错误继续保留在返回给调用方的 observation 中。
    void observation.catch(() => undefined);
    return observation;
  }

  function requestRuntimeStop(
    entry: LocalCommandExecutionEntry,
    cause: CommandExecutionRuntimeStopCause,
  ): Promise<CommandExecutionTerminalV1> {
    if (entry.terminal) return Promise.resolve(entry.terminal);
    if (entry.stopPromise) return entry.stopPromise;
    const runtime = entry.runtime;
    if (!runtime) {
      return entry.settlement.then((terminal) => {
        if (terminal) return terminal;
        throw new LocalCommandExecutionOwnerError(
          'Starting command was released without a terminal',
          [entry.binding],
        );
      });
    }

    entry.state = 'stopping';
    entry.stopCause ??= cause;
    const acceptedCause = entry.stopCause;
    // native/platform adapter 可能在返回 Promise 前同步抛错。先建立 Promise 边界并登记
    // stopPromise，才能保证 tombstone 通知不会中断，删除 barrier 也能观察并重试失败。
    const stopPromise = Promise.resolve()
      .then(() => runtime.stopAndWait(acceptedCause))
      .then(candidate => settleTerminal(entry, candidate))
      .catch((error: unknown) => {
        entry.stopFailure = error;
        throw error;
      })
      .finally(() => {
        if (entry.stopPromise === stopPromise) {
          entry.stopPromise = undefined;
        }
      });
    entry.stopPromise = stopPromise;
    void stopPromise.catch(() => undefined);
    return stopPromise;
  }

  function beginConversationStopInternal(conversationId: CommandConversationId): void {
    if (lifecycle === 'ended') return;
    if (!stoppingConversations.has(conversationId)) {
      publishLifecycleEvent({ type: 'conversation_stopping', conversationId });
    }
    stoppingConversations.add(conversationId);
    for (const entry of entries.values()) {
      if (entry.binding.identity.conversation_id !== conversationId) continue;
      if (entry.state === 'reserved') {
        settleReservedForOwnerEnd(entry);
        continue;
      }
      entry.stopCause ??= 'owner_ended';
      if (
        entry.state === 'starting'
        || entry.state === 'running'
        || entry.state === 'stopping'
      ) {
        void requestRuntimeStop(entry, 'owner_ended').catch(() => undefined);
      }
    }
  }

  function beginAgentRunStopInternal(input: {
    readonly conversationId: CommandConversationId;
    readonly agentRunId: CommandAgentRunId;
  }): void {
    if (lifecycle === 'ended') return;
    stoppingAgentRuns.add(agentRunScopeKey(input));
    for (const entry of entries.values()) {
      if (
        entry.binding.identity.conversation_id !== input.conversationId
        || entry.binding.identity.agent_run_id !== input.agentRunId
      ) continue;
      if (entry.state === 'reserved') {
        settleReservedForOwnerEnd(entry);
        continue;
      }
      entry.stopCause ??= 'owner_ended';
      if (
        entry.state === 'starting'
        || entry.state === 'running'
        || entry.state === 'stopping'
      ) {
        void requestRuntimeStop(entry, 'owner_ended').catch(() => undefined);
      }
    }
  }

  async function waitForEntries(
    belongsToScope: (identity: CommandExecutionOwnerBindingV1['identity']) => boolean,
    scopeName?: string,
  ): Promise<void> {
    function assertStoppedExecutionCanRelease(
      entry: LocalCommandExecutionEntry,
      terminal: CommandExecutionTerminalV1,
    ): void {
      const release = evaluateCommandExecutionStopRelease(terminal);
      if (release.status === 'blocked') {
        throw new LocalCommandExecutionOwnerError(
          `Command execution cannot release deletion barrier: ${release.reason}`,
          [entry.binding, terminal],
        );
      }
    }

    const targets = Array.from(entries.values()).filter(entry => belongsToScope(entry.binding.identity));
    const results = await Promise.allSettled([
      ...targets.map(async (entry) => {
        if (entry.stopFailure !== undefined) {
          const failure = entry.stopFailure;
          entry.stopFailure = undefined;
          throw failure;
        }
        if (entry.state === 'running' || entry.state === 'stopping') {
          try {
            const terminal = await requestRuntimeStop(entry, 'owner_ended');
            assertStoppedExecutionCanRelease(entry, terminal);
          } catch (error: unknown) {
            // 当前 barrier 已经收到本次 stop 失败，不能把同一个错误再留给下一次重试；
            // 若失败先于 waiter 到达，上方 stopFailure 分支仍负责报告一次。
            if (entry.stopFailure === error) entry.stopFailure = undefined;
            throw error;
          }
          return;
        }
        const terminal = await entry.settlement;
        if (!terminal) {
          throw new LocalCommandExecutionOwnerError(
            'Conversation stop observed a released starting command',
            [entry.binding],
          );
        }
        assertStoppedExecutionCanRelease(entry, terminal);
      }),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);
    if (failures.length > 0) {
      throw new LocalCommandExecutionOwnerError(
        `Failed to stop ${failures.length} command execution(s)${scopeName ? ` for ${scopeName}` : ''}`,
        failures,
      );
    }
  }

  function waitForConversationEntries(conversationId: CommandConversationId): Promise<void> {
    return waitForEntries(
      identity => identity.conversation_id === conversationId,
    );
  }

  function waitForAgentRunEntries(input: {
    readonly conversationId: CommandConversationId;
    readonly agentRunId: CommandAgentRunId;
  }): Promise<void> {
    return waitForEntries(
      identity => identity.conversation_id === input.conversationId
        && identity.agent_run_id === input.agentRunId,
      'Agent run',
    );
  }

  async function queryProcessOutput(
    request: ProcessControlRequestV1,
  ): Promise<CommandProcessOutputQueryResult> {
    const { entry, replay, target } = resolveProcessTarget(request);
    const acceptance = acceptProcessAction({
      owner: ownerSnapshot(),
      request,
      target,
    });
    if (acceptance.status === 'rejected') return acceptance;
    if (!isProcessOutputQueryRequest(request)) {
      return { status: 'rejected', code: 'action_not_supported' };
    }

    const outputObservation = replay?.outputObservation ?? entry?.outputObservation;
    const settledTextOutput = replay?.settledTextOutput ?? entry?.settledTextOutput;
    const startedAtMs = replay?.startedAtMs ?? entry?.startedAtMs;
    if (!outputObservation || !settledTextOutput || startedAtMs === undefined) {
      return { status: 'rejected', code: 'incompatible_state' };
    }
    const waitDeadlineAt = request.action.type === 'wait'
      ? Date.now() + request.action.wait_timeout_ms
      : undefined;
    const read = request.action.type === 'poll'
      ? outputObservation.read(request.action.cursor)
      : await outputObservation.waitForChange({
          afterCursor: request.action.cursor,
          waitTimeoutMs: request.action.wait_timeout_ms,
        });
    if (read.status === 'invalid_cursor') {
      return { status: 'rejected', code: 'invalid_cursor' };
    }

    let terminal = replay?.terminal
      ?? (entry?.startSettled ? entry.terminal : undefined);
    if (
      !terminal
      && read.observation.outputPhase === 'closed'
      && entry
      && waitDeadlineAt !== undefined
    ) {
      // text observation 会先于 ToolOutputStore/artifact settlement 关闭。wait 可以在自己的
      // 剩余期限内等可信 terminal，但 poll 必须立即返回，wait 也绝不能越过调用方期限。
      const remainingMs = waitDeadlineAt - Date.now();
      if (remainingMs > 0) {
        terminal = await new Promise<CommandExecutionTerminalV1 | undefined>((resolve) => {
          let settled = false;
          const finish = (value: CommandExecutionTerminalV1 | undefined): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
          };
          const timer = setTimeout(() => finish(undefined), remainingMs);
          void entry.settlement.then(value => finish(value ?? undefined));
        });
      }
    }
    if (terminal) {
      return {
        status: 'terminal',
        processHandle: request.process_handle,
        startedAtMs,
        observation: read.observation,
        terminal,
        settledTextOutput: await settledTextOutput,
      };
    }
    return {
      status: 'running',
      processHandle: request.process_handle,
      startedAtMs,
      observation: read.observation,
    };
  }

  async function cancelProcessAndWait(
    request: ProcessCancellationRequestV1,
  ): Promise<CommandProcessCancellationResult> {
    const { entry, target } = resolveProcessTarget(request);
    const acceptance = acceptProcessAction({
      owner: ownerSnapshot(),
      request,
      target,
    });
    if (acceptance.status === 'rejected') return acceptance;
    if (
      acceptance.status === 'terminal_replay'
      || !entry
      || !entry.settledTextOutput
      || entry.startedAtMs === undefined
    ) {
      return { status: 'rejected', code: 'incompatible_state' };
    }

    // cancel 只提交终止原因，整树结束、输出排空和资源释放仍由同一个 runtime terminal
    // 证明。并发 cancel 复用 requestRuntimeStop 的 Promise，不能重复触发平台 kill。
    // terminal 会同步触发 entry 释放，因此必须先捕获稳定 sidecar Promise。
    const settledTextOutput = entry.settledTextOutput;
    const terminal = await requestRuntimeStop(entry, 'user_cancelled');
    return {
      status: 'terminal',
      processHandle: request.process_handle,
      startedAtMs: entry.startedAtMs,
      terminal,
      settledTextOutput: await settledTextOutput,
    };
  }

  function controlProcessInteraction(
    request: Parameters<CommandProcessControlPort['controlInteraction']>[0],
  ): ReturnType<CommandProcessControlPort['controlInteraction']> {
    const { entry, target } = resolveProcessTarget(request);
    return controlLocalCommandProcessInteraction({
      owner: ownerSnapshot(),
      request,
      entry,
      target,
      isCurrentEntry: candidate => entries.get(
        candidate.binding.identity.command_execution_id,
      ) === candidate,
    });
  }

  function submitProtectedInput(
    request: Parameters<CommandProcessControlPort['submitProtectedInput']>[0],
  ): ReturnType<CommandProcessControlPort['submitProtectedInput']> {
    const entry = entries.get(request.binding.identity.command_execution_id);
    return submitProtectedLocalCommandInput({
      ownerLifecycle: lifecycle,
      request,
      entry,
      isCurrentEntry: candidate => entries.get(
        candidate.binding.identity.command_execution_id,
      ) === candidate,
    });
  }

  const owner: LocalCommandOwnerPort = {
    submitProtectedInput,
    reserve(request) {
      const executionId = request.identity.command_execution_id;
      const acceptance = acceptCommandExecutionReservation({
        owner: ownerSnapshot(),
        identity: request.identity,
        conversationStopping: stoppingConversations.has(request.identity.conversation_id)
          || stoppingAgentRuns.has(agentRunScopeKey({
            conversationId: request.identity.conversation_id,
            agentRunId: request.identity.agent_run_id,
          })),
        executionAlreadyExists: entries.has(executionId),
        // reserve 是同步线性化点。Map 中只存在四类活动项，因此这里同时覆盖审批等待、
        // 启动、运行和可信收尾，且并发调用不能一起穿过上限。
        capacityReached: entries.size >= maximumActiveExecutions,
      });
      if (acceptance.status === 'rejected') return acceptance;

      const binding = parseCommandExecutionOwnerBinding({
        protocol_version: 1,
        kind: 'command_execution_owner_binding',
        identity: request.identity,
        process_handle: createProcessHandle(),
        mode: request.mode,
      });
      entries.set(executionId, createLocalCommandExecutionEntry(binding));
      return { status: 'reserved', binding };
    },

    release(binding) {
      if (binding.identity.owner_generation_id !== generationId) {
        return { status: 'rejected', code: 'scope_mismatch' };
      }
      const entry = entries.get(binding.identity.command_execution_id);
      if (!entry) return { status: 'rejected', code: 'unknown_reservation' };
      if (!hasSameCommandExecutionOwnerBinding(entry.binding, binding)) {
        return { status: 'rejected', code: 'scope_mismatch' };
      }
      if (entry.state !== 'reserved') {
        return { status: 'rejected', code: 'incompatible_state' };
      }
      settleReleased(entry);
      return { status: 'released' };
    },

    beginAgentRunStop(input) {
      beginAgentRunStopInternal(input);
    },

    async stopAgentRunAndWait(input) {
      beginAgentRunStopInternal(input);
      await waitForAgentRunEntries(input);
      // 这里仍处在 Agent 调用栈内，必须继续保留屏障；最外层退出时由生命周期凭证精准释放。
    },

    releaseAgentRunStopBarrier(input) {
      stoppingAgentRuns.delete(agentRunScopeKey(input));
    },

    async claimAndStart(request) {
      const entry = entries.get(request.binding.identity.command_execution_id);
      const acceptance = acceptCommandExecutionStart({
        owner: ownerSnapshot(),
        requestedBinding: request.binding,
        reservedBinding: entry?.binding,
        reservationState: entry?.state,
        conversationStopping: stoppingConversations.has(request.binding.identity.conversation_id)
          || stoppingAgentRuns.has(agentRunScopeKey({
            conversationId: request.binding.identity.conversation_id,
            agentRunId: request.binding.identity.agent_run_id,
          })),
      });
      if (acceptance.status === 'rejected') return acceptance;
      if (!entry) {
        return { status: 'rejected', code: 'unknown_reservation' };
      }

      // prepareRuntime 必须同步且不得创建 OS 资源。owner 先保存 runtime，再允许 start 内 spawn；
      // 这样启动握手、reader 或平台 setup 失败时，停止与终态仍有明确 owner。
      entry.state = 'starting';
      let runtime: PreparedCommandExecutionRuntime;
      try {
        runtime = request.prepareRuntime();
      } catch (error: unknown) {
        settleReleased(entry);
        throw error;
      }
      if (!doesInteractionCapabilityMatchExecutionMode(entry.binding.mode, runtime.interaction)) {
        settleReleased(entry);
        throw new LocalCommandExecutionOwnerError(
          'Command runtime interaction capability does not match execution mode',
          [entry.binding],
        );
      }
      entry.runtime = runtime;
      entry.outputObservation = runtime.outputObservation;
      entry.settledTextOutput = runtime.settledTextOutput;
      const terminal = observeRuntimeTerminal(entry, runtime);

      if (entry.stopCause) {
        const stopped = await requestRuntimeStop(entry, entry.stopCause);
        discardPendingHandleDecision(entry.binding);
        return { status: 'terminal', terminal: stopped };
      }

      let started: CommandExecutionPreparedRuntimeStartResult;
      entry.startSettled = false;
      try {
        started = await runtime.start();
      } catch (startError: unknown) {
        entry.startSettled = true;
        settleTerminalBarrierIfReady(entry);
        try {
          const stopped = await requestRuntimeStop(
            entry,
            entry.stopCause ?? 'runtime_start_failed',
          );
          discardPendingHandleDecision(entry.binding);
          // start 已把资源交给 owner 后，stopAndWait 的可信终态比 JavaScript 异常更接近
          // 用户事实。清理成功时必须把它交回 Shell/审计；只有清理失败才抛组合错误。
          return {
            status: 'terminal',
            terminal: stopped,
            ...(entry.startedAtMs === undefined ? {} : { startedAtMs: entry.startedAtMs }),
          };
        } catch (stopError: unknown) {
          discardPendingHandleDecision(entry.binding);
          throw new LocalCommandExecutionOwnerError(
            'Command runtime start failed and cleanup did not settle',
            [startError, stopError],
          );
        }
      }
      entry.startSettled = true;
      if (started.startedAtMs !== undefined) entry.startedAtMs = started.startedAtMs;
      settleTerminalBarrierIfReady(entry);

      if (started.status === 'terminal') {
        const settled = settleTerminal(entry, started.terminal);
        discardPendingHandleDecision(entry.binding);
        return {
          status: 'terminal',
          terminal: settled,
          ...(entry.startedAtMs === undefined ? {} : { startedAtMs: entry.startedAtMs }),
        };
      }
      if (entry.terminal) {
        discardPendingHandleDecision(entry.binding);
        return {
          status: 'terminal',
          terminal: entry.terminal,
          ...(entry.startedAtMs === undefined ? {} : { startedAtMs: entry.startedAtMs }),
        };
      }

      if (entry.stopCause) {
        const stopped = await requestRuntimeStop(entry, entry.stopCause);
        discardPendingHandleDecision(entry.binding);
        return {
          status: 'terminal',
          terminal: stopped,
          ...(entry.startedAtMs === undefined ? {} : { startedAtMs: entry.startedAtMs }),
        };
      }
      entry.state = 'running';
      return {
        status: 'running',
        binding: entry.binding,
        startedAtMs: started.startedAtMs,
        terminal,
      };
    },

    publishHandle(binding) {
      if (lifecycle === 'ended') return { status: 'rejected', code: 'owner_ended' };
      if (binding.identity.owner_generation_id !== generationId) {
        return { status: 'rejected', code: 'scope_mismatch' };
      }
      if (lifecycle === 'ending') return { status: 'rejected', code: 'owner_ending' };

      const replay = terminalReplays.findPublishedForBinding(binding);
      if (replay && hasSameCommandExecutionOwnerBinding(replay.binding, binding)) {
        publishLifecycleEvent({ type: 'handle_published', binding: replay.binding });
        publishLifecycleEvent({
          type: 'terminal_settled',
          binding: replay.binding,
          startedAtMs: replay.startedAtMs,
          terminal: replay.terminal,
        });
        return { status: 'published', binding: replay.binding };
      }
      const pending = terminalReplays.takePending(binding);
      if (pending.status !== 'missing') {
        if (pending.status === 'scope_mismatch') {
          return { status: 'rejected', code: 'scope_mismatch' };
        }
        terminalReplays.rememberPublished(pending.replay);
        publishLifecycleEvent({ type: 'handle_published', binding: pending.replay.binding });
        publishLifecycleEvent({
          type: 'terminal_settled',
          binding: pending.replay.binding,
          startedAtMs: pending.replay.startedAtMs,
          terminal: pending.replay.terminal,
        });
        return { status: 'published', binding: pending.replay.binding };
      }
      const entry = entries.get(binding.identity.command_execution_id);
      if (!entry) return { status: 'rejected', code: 'unknown_reservation' };
      if (!hasSameCommandExecutionOwnerBinding(entry.binding, binding)) {
        return { status: 'rejected', code: 'scope_mismatch' };
      }
      if (entry.state !== 'running' || entry.terminal) {
        return { status: 'rejected', code: 'incompatible_state' };
      }
      entry.handlePublished = true;
      publishLifecycleEvent({ type: 'handle_published', binding: entry.binding });
      return { status: 'published', binding: entry.binding };
    },

    discardUnpublishedHandle(binding) {
      if (lifecycle === 'ended') return { status: 'rejected', code: 'owner_ended' };
      if (binding.identity.owner_generation_id !== generationId) {
        return { status: 'rejected', code: 'scope_mismatch' };
      }
      if (lifecycle === 'ending') return { status: 'rejected', code: 'owner_ending' };
      const replay = terminalReplays.findPublishedForBinding(binding);
      if (replay) return { status: 'rejected', code: 'incompatible_state' };
      return discardPendingHandleDecision(binding)
        ? { status: 'discarded' }
        : { status: 'rejected', code: 'unknown_reservation' };
    },

    queryOutput: queryProcessOutput,

    readPublishedBinding(request) {
      const { entry, replay, expiredBinding } = resolveProcessTarget(request);
      // 这里读取的是已经通过 conversation/run/generation/handle 全作用域匹配的身份，
      // 即使具体 action 随后因状态冲突被拒绝，也仍需把这次拒绝记到正确 execution。
      return replay?.binding ?? expiredBinding ?? entry?.binding;
    },

    controlInteraction: controlProcessInteraction,

    cancelAndWait: cancelProcessAndWait,

    forgetDeletedConversation(conversationId) {
      terminalReplays.forgetConversation(conversationId);
      publishLifecycleEvent({ type: 'conversation_forgotten', conversationId });
    },

    beginConversationStop(conversationId) {
      beginConversationStopInternal(conversationId);
    },

    async stopConversationAndWait(conversationId) {
      beginConversationStopInternal(conversationId);
      await waitForConversationEntries(conversationId);
      // 只有全部 execution 收口后才移除 tombstone；失败时函数会在这里之前退出。
      clearAgentRunTombstonesForConversation(conversationId);
      stoppingConversations.delete(conversationId);
    },

    endAndWait() {
      if (lifecycle === 'ended') return Promise.resolve();
      if (endingPromise) return endingPromise;
      lifecycle = 'ending';
      publishLifecycleEvent({ type: 'owner_ending' });
      // 终态查询只属于当前活跃 owner；进入 ending 后不再保留无资源 replay。
      terminalReplays.clear();
      const conversationIds = new Set(
        Array.from(entries.values()).map(entry => entry.binding.identity.conversation_id),
      );
      for (const conversationId of conversationIds) {
        beginConversationStopInternal(conversationId);
      }

      const pending = (async () => {
        const results = await Promise.allSettled(
          Array.from(conversationIds, conversationId => waitForConversationEntries(conversationId)),
        );
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map(result => result.reason);
        if (failures.length > 0) {
          throw new LocalCommandExecutionOwnerError(
            `Failed to end command owner for ${failures.length} conversation(s)`,
            failures,
          );
        }
        stoppingConversations.clear();
        stoppingAgentRuns.clear();
        lifecycle = 'ended';
        lifecycleListeners.clear();
      })().finally(() => {
        if (lifecycle !== 'ended') endingPromise = undefined;
      });
      endingPromise = pending;
      return pending;
    },

    readActivitySnapshot() {
      const counts: Record<CommandExecutionActivityState, number> = {
        reserved: 0,
        starting: 0,
        running: 0,
        stopping: 0,
      };
      for (const entry of entries.values()) counts[entry.state] += 1;
      const replaySnapshot = terminalReplays.readSnapshot();
      return Object.freeze({
        generationId,
        lifecycle,
        reservedCount: counts.reserved,
        startingCount: counts.starting,
        runningCount: counts.running,
        stoppingCount: counts.stopping,
        agentRunStopBarrierCount: stoppingAgentRuns.size,
        pendingHandleDecisionCount: replaySnapshot.pendingCount,
        terminalReplayCount: replaySnapshot.publishedCount,
        expiredHandleCount: replaySnapshot.expiredCount,
      });
    },

    subscribeExecutionLifecycle(listener) {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
  };

  return Object.freeze(owner);
}
