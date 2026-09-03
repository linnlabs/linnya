import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  SandboxRunnerExecutionOptions,
  SandboxRunnerRequest,
  SandboxRunnerResult,
} from 'src/features/sandbox/definitions/sandboxRunner';
import type {
  SandboxEvaluatorLaunch,
  SandboxUtilityTerminationCause,
} from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport';
import {
  parseSandboxUtilityGeneration,
} from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport';
import {
  publishSandboxRequestMailbox,
  readSandboxResultMailbox,
} from 'src/features/sandbox/runners/local-process/functions/sandboxMailboxFiles';
import type {
  LocalProcessPlatformRuntime,
} from 'src/infra/adapters/local-process-runtime/platform-runtime';
import {
  serializeLocalProcessPlatformRuntime,
} from 'src/infra/adapters/local-process-runtime/platform-runtime';
import { getLogger } from 'src/shared/logger';
import type { SandboxProductionScope } from 'src/app-hosts/linnya/application/conversation-runtime';
import type {
  SandboxUtilityProcessForkPort,
} from '../definitions/sandboxUtilityProcessFork';
import type {
  SandboxUtilityProcessExit,
  SandboxUtilityProcessTerminal,
  SandboxUtilityProcessTransport,
} from '../definitions/sandboxUtilityProcessTransport';
import { createSandboxUtilityProcessTransport } from '../functions/createSandboxUtilityProcessTransport';
import {
  projectSandboxRunnerResult,
  resolveSandboxCleanupStatus,
} from '../functions/projectSandboxRunnerResult';

const SANDBOX_VM_RESULT_GRACE_MS = 250;
const SANDBOX_HOST_SETTLEMENT_GRACE_MS = 15_000;
const SANDBOX_RUN_DIRECTORY_DELETE_MAX_RETRIES = 10;
const SANDBOX_RUN_DIRECTORY_DELETE_RETRY_DELAY_MS = 100;
const logger = getLogger('SandboxProductionRuntime');

type HostTerminationIntent = Extract<
  SandboxUtilityTerminationCause,
  'cancelled' | 'owner_ended'
>;

interface ActiveSandboxRun {
  requestTermination(intent: HostTerminationIntent): void;
  attachTransport(transport: SandboxUtilityProcessTransport): void;
  closeControl(): void;
  readTerminationIntent(): HostTerminationIntent | undefined;
  waitForControl(): Promise<void>;
  waitForTerminationIntent(): Promise<HostTerminationIntent>;
  bindResidualCleanup(cleanup: () => Promise<void>): void;
  hasResidualCleanup(): boolean;
  bindSettlement(settlement: Promise<SandboxRunnerResult>): void;
  waitForSettlement(): Promise<SandboxRunnerResult>;
}

class SandboxHostSettlementError extends Error {
  constructor(readonly failures: readonly unknown[], message: string) {
    super(message);
    this.name = 'SandboxHostSettlementError';
  }
}

export interface CreateSandboxProductionScopeInput {
  readonly storageRoot: string;
  readonly utilityPath: string;
  readonly utilityEnvironment: Readonly<Record<string, string>>;
  readonly evaluator: SandboxEvaluatorLaunch;
  readonly platformRuntime: LocalProcessPlatformRuntime;
  readonly utilityProcessFork: SandboxUtilityProcessForkPort;
  /** App Host 文件系统 adapter 边界；生产默认使用严格的固定目录删除策略。 */
  readonly removeRunDirectory?: (runDirectory: string) => Promise<void>;
}

/**
 * Sandbox 的 App Host 唯一组合根。它只编排一次性目录、mailbox 和 Utility；Evaluator
 * 的 spawn、整树停止与平台资源释放继续由 Utility 内的公共 owner 独占。
 */
export function createSandboxProductionScope(
  input: CreateSandboxProductionScopeInput,
): SandboxProductionScope {
  requireAbsolutePath(input.storageRoot, 'sandbox storage root');
  requireAbsolutePath(input.utilityPath, 'sandbox utility path');
  requireAbsolutePath(input.evaluator.executablePath, 'sandbox evaluator executable');
  requireAbsolutePath(input.evaluator.entryPath, 'sandbox evaluator entry');
  const utilityProcessFork = input.utilityProcessFork;
  const utilityEnvironment = Object.freeze({ ...input.utilityEnvironment });
  const evaluator = Object.freeze({
    executablePath: input.evaluator.executablePath,
    entryPath: input.evaluator.entryPath,
    environment: Object.freeze({ ...input.evaluator.environment }),
  });
  const serializedPlatformRuntime = serializeLocalProcessPlatformRuntime(input.platformRuntime);
  const removeRunDirectory = input.removeRunDirectory ?? removeSandboxRunDirectory;
  const activeRuns = new Set<ActiveSandboxRun>();
  let ownerEnded = false;
  let ownerSettlement: Promise<void> | undefined;

  return Object.freeze({
    execute(
      request: SandboxRunnerRequest,
      options?: SandboxRunnerExecutionOptions,
    ): Promise<SandboxRunnerResult> {
      if (ownerEnded) {
        return Promise.resolve(projectSandboxRunnerResult({
          runToken: createRunToken(),
          limits: request.limits,
          utilityForked: false,
          terminationIntent: 'owner_ended',
        }));
      }
      if (options?.abortSignal?.aborted) {
        return Promise.resolve(projectSandboxRunnerResult({
          runToken: createRunToken(),
          limits: request.limits,
          utilityForked: false,
          terminationIntent: 'cancelled',
        }));
      }

      // 先同步进入 active 集合，再开始任何文件或进程 await。这样 App owner 一旦关门，
      // 已接纳的运行一定在其等待集合中，不会落入“尚未登记但已经开始”的空窗。
      const runToken = createRunToken();
      const activeRun = createActiveSandboxRun(runToken);
      activeRuns.add(activeRun);
      const settlement = executeActiveSandboxRun({
        runToken,
        request,
        options,
        activeRun,
        storageRoot: input.storageRoot,
        utilityPath: input.utilityPath,
        utilityEnvironment,
        evaluator,
        serializedPlatformRuntime,
        utilityProcessFork,
        removeRunDirectory,
      }).finally(() => {
        if (!activeRun.hasResidualCleanup()) activeRuns.delete(activeRun);
      });
      activeRun.bindSettlement(settlement);
      return settlement;
    },

    endOwnerAndWait(): Promise<void> {
      if (ownerSettlement) return ownerSettlement;
      ownerEnded = true;
      const admittedRuns = [...activeRuns];
      for (const run of admittedRuns) run.requestTermination('owner_ended');
      const attempt = Promise.all(admittedRuns.map(async run => {
        await run.waitForSettlement();
        activeRuns.delete(run);
      })).then(() => undefined);
      const trackedAttempt = attempt.finally(() => {
        if (ownerSettlement === trackedAttempt) ownerSettlement = undefined;
      });
      ownerSettlement = trackedAttempt;
      return trackedAttempt;
    },
  });
}

async function executeActiveSandboxRun(input: {
  readonly runToken: string;
  readonly request: SandboxRunnerRequest;
  readonly options?: SandboxRunnerExecutionOptions;
  readonly activeRun: ActiveSandboxRun;
  readonly storageRoot: string;
  readonly utilityPath: string;
  readonly utilityEnvironment: Readonly<Record<string, string>>;
  readonly evaluator: SandboxEvaluatorLaunch;
  readonly serializedPlatformRuntime: string;
  readonly utilityProcessFork: SandboxUtilityProcessForkPort;
  readonly removeRunDirectory: (runDirectory: string) => Promise<void>;
}): Promise<SandboxRunnerResult> {
  const runToken = input.runToken;
  let runDirectory: string | undefined;
  let transport: SandboxUtilityProcessTransport | undefined;
  let terminal: SandboxUtilityProcessTerminal | undefined;
  let utilityExit: SandboxUtilityProcessExit | undefined;
  let evaluation: Awaited<ReturnType<typeof readSandboxResultMailbox>> | undefined;
  let hostSettlementFailure: Error | undefined;
  let hostCleanupIncomplete = false;
  let utilityForked = false;
  const abortHandler = (): void => input.activeRun.requestTermination('cancelled');
  input.options?.abortSignal?.addEventListener('abort', abortHandler, { once: true });

  try {
    // 全部启动参数必须在 fork 前冻结；不能先创建 Utility，再发现期限已溢出并补做清理。
    const utilityTimeoutMs = addSafeInteger(
      input.request.limits.timeoutMs,
      SANDBOX_VM_RESULT_GRACE_MS,
    );
    const hostHardDeadlineMs = addSafeInteger(
      utilityTimeoutMs,
      SANDBOX_HOST_SETTLEMENT_GRACE_MS,
    );
    await mkdir(input.storageRoot, { recursive: true, mode: 0o700 });
    runDirectory = await mkdtemp(path.join(input.storageRoot, 'run-'));
    await publishSandboxRequestMailbox({
      runDirectory,
      runToken,
      request: input.request,
    });

    if (!input.activeRun.readTerminationIntent()) {
      const generation = parseSandboxUtilityGeneration(randomUUID());
      const child = input.utilityProcessFork.fork({
        utilityPath: input.utilityPath,
        argv: [generation, input.serializedPlatformRuntime],
        environment: input.utilityEnvironment,
      });
      utilityForked = true;
      transport = createSandboxUtilityProcessTransport({ child, generation });
      input.activeRun.attachTransport(transport);

      [terminal] = await Promise.all([
        waitForSandboxTerminal({
          terminal: transport.waitForTerminal(),
          terminationIntent: input.activeRun.waitForTerminationIntent(),
          hardDeadlineMs: hostHardDeadlineMs,
          terminationDeadlineMs: SANDBOX_HOST_SETTLEMENT_GRACE_MS,
        }),
        transport.sendStart({
          kind: 'sandbox_start',
          runToken,
          runDirectory,
          // VM 使用精确 timeout；Utility 多保留固定宽限，让结构化 timeout 与已有日志
          // 先提交 mailbox，避免 host 抢先杀进程后把业务超时误写成 transport failure。
          timeoutMs: utilityTimeoutMs,
          idleTimeoutMs: input.request.limits.idleTimeoutMs,
          maximumHeapMb: input.request.limits.maxHeapMb,
          evaluator: input.evaluator,
        }),
      ]);
      input.activeRun.closeControl();
      await input.activeRun.waitForControl();
      utilityExit = await transport.waitForExit();

      if (terminal.terminal.cause === 'natural' && terminal.terminal.control.completed) {
        evaluation = await readSandboxResultMailbox({ runDirectory, runToken });
      }
    }
  } catch (error: unknown) {
    input.activeRun.closeControl();
    if (transport && input.activeRun.readTerminationIntent() === 'owner_ended') {
      try {
        // owner 可能在 Utility ready 前关门。此时 child 正确 ACK owner_end 后会直接退出，
        // 不会伪造一个从未启动的 Evaluator terminal；ACK + 零退出就是这条路径的完整事实。
        await input.activeRun.waitForControl();
        utilityExit = await transport.waitForExit();
        if (utilityExit.exitCode !== 0 || utilityExit.transportFailure) throw error;
      } catch (ownerSettlementFailure: unknown) {
        hostSettlementFailure = toError(ownerSettlementFailure);
      }
    } else if (transport) {
      hostSettlementFailure = toError(error);
      try {
        utilityExit = await transport.killAndWait();
      } catch (killFailure: unknown) {
        hostCleanupIncomplete = true;
        hostSettlementFailure = new SandboxHostSettlementError(
          [hostSettlementFailure, killFailure],
          'Sandbox host 与 Utility 收口均失败',
        );
      }
    } else {
      hostSettlementFailure = toError(error);
    }
  } finally {
    input.options?.abortSignal?.removeEventListener('abort', abortHandler);
    input.activeRun.closeControl();
    if (runDirectory && utilityForked && !utilityExit) {
      const retainedRunDirectory = runDirectory;
      const retainedTransport = transport;
      if (!retainedTransport) {
        hostSettlementFailure ??= new Error('sandbox utility transport identity was lost');
        hostCleanupIncomplete = true;
      } else {
        hostCleanupIncomplete = true;
        // kill 已有界失败时不能先删 mailbox 或丢掉 owner。App 退出重试只保留这条
        // 精确 Utility 与目录清理动作，成功观察 exit 后才释放 active 记录。
        input.activeRun.bindResidualCleanup(async () => {
          await retainedTransport.killAndWait();
          await input.removeRunDirectory(retainedRunDirectory);
        });
      }
    } else if (runDirectory) {
      try {
        // 目录由本轮 mkdtemp 返回，清理只使用冻结后的精确路径，禁止按 token 或通配符扫描。
        await input.removeRunDirectory(runDirectory);
      } catch (cleanupFailure: unknown) {
        hostCleanupIncomplete = true;
        const retainedRunDirectory = runDirectory;
        input.activeRun.bindResidualCleanup(() => (
          input.removeRunDirectory(retainedRunDirectory)
        ));
        hostSettlementFailure = hostSettlementFailure
          ? new SandboxHostSettlementError(
              [hostSettlementFailure, cleanupFailure],
              'Sandbox 执行与运行目录清理均失败',
            )
          : toError(cleanupFailure);
      }
    }
  }

  const cleanupStatus = resolveSandboxCleanupStatus({
    terminal: terminal?.terminal,
    hostCleanupIncomplete,
  });
  if (cleanupStatus === 'failed') {
    // 不记录 token、路径、源码、globals 或底层错误文本；这些内容可能包含用户数据。
    // 稳定状态足以区分业务首因和资源收口；不能因 timeout/cancel 已确定就吞掉次生失败。
    logger.error('[SandboxRuntime] resource settlement incomplete', {
      runId: input.request.runId,
      utilityForked,
      utilityExitObserved: utilityExit !== undefined,
      residualCleanupPending: input.activeRun.hasResidualCleanup(),
      cleanupStatus,
    });
  }

  return projectSandboxRunnerResult({
    runToken,
    limits: input.request.limits,
    terminationIntent: input.activeRun.readTerminationIntent(),
    terminal: terminal?.terminal,
    utilityExit,
    evaluation,
    utilityForked,
    hostSettlementFailure,
    hostCleanupIncomplete,
  });
}

function removeSandboxRunDirectory(runDirectory: string): Promise<void> {
  // Windows 在进程树和原生 observer 已释放后，目录项仍可能短暂返回
  // EPERM/EBUSY/ENOTEMPTY；Utility 崩溃时 Job 句柄也随进程关闭，目录删除还是 host
  // 能观察到的最后一道资源屏障。10 次线性重试最坏额外等待 5.5 秒，是 terminal
  // deadline 结束后的独立有界清理阶段；超过预算继续把真实失败交给 owner，不能
  // 吞错或无限等待。
  return rm(runDirectory, {
    recursive: true,
    force: true,
    maxRetries: SANDBOX_RUN_DIRECTORY_DELETE_MAX_RETRIES,
    retryDelay: SANDBOX_RUN_DIRECTORY_DELETE_RETRY_DELAY_MS,
  });
}

function createActiveSandboxRun(runToken: string): ActiveSandboxRun {
  let terminationIntent: HostTerminationIntent | undefined;
  let transport: SandboxUtilityProcessTransport | undefined;
  let controlClosed = false;
  let controlSettlement: Promise<void> = Promise.resolve();
  let settlement: Promise<SandboxRunnerResult> | undefined;
  let residualCleanup: (() => Promise<void>) | undefined;
  let resolveTerminationIntent: (intent: HostTerminationIntent) => void = () => {};
  const terminationIntentSettlement = new Promise<HostTerminationIntent>(resolve => {
    resolveTerminationIntent = resolve;
  });

  function dispatchTermination(): void {
    if (!transport || !terminationIntent || controlClosed) return;
    controlSettlement = terminationIntent === 'owner_ended'
      ? transport.endOwner()
      : transport.sendCancel(runToken);
    // 请求会在主执行链关闭 control 前被正式 await；先挂观察者只是避免 ready 等待期间
    // 的 ACK 失败被 Node 当成未处理 rejection，不能把失败吞掉或改写为成功。
    void controlSettlement.catch(() => undefined);
  }

  return Object.freeze({
    requestTermination(intent: HostTerminationIntent) {
      if (terminationIntent || controlClosed) return;
      terminationIntent = intent;
      resolveTerminationIntent(intent);
      dispatchTermination();
    },
    attachTransport(attachedTransport: SandboxUtilityProcessTransport) {
      transport = attachedTransport;
      dispatchTermination();
    },
    closeControl() {
      controlClosed = true;
    },
    readTerminationIntent() {
      return terminationIntent;
    },
    waitForControl() {
      return controlSettlement;
    },
    waitForTerminationIntent() {
      return terminationIntentSettlement;
    },
    bindResidualCleanup(cleanup: () => Promise<void>) {
      if (residualCleanup) throw new Error('sandbox residual cleanup is already bound');
      residualCleanup = cleanup;
    },
    hasResidualCleanup() {
      return residualCleanup !== undefined;
    },
    bindSettlement(boundSettlement: Promise<SandboxRunnerResult>) {
      if (settlement) throw new Error('sandbox active run settlement is already bound');
      settlement = boundSettlement;
    },
    async waitForSettlement() {
      if (!settlement) throw new Error('sandbox active run settlement is not bound');
      const result = await settlement;
      if (residualCleanup) {
        await residualCleanup();
        residualCleanup = undefined;
      }
      return result;
    },
  });
}

function waitForSandboxTerminal(input: {
  readonly terminal: Promise<SandboxUtilityProcessTerminal>;
  readonly terminationIntent: Promise<HostTerminationIntent>;
  readonly hardDeadlineMs: number;
  readonly terminationDeadlineMs: number;
}): Promise<SandboxUtilityProcessTerminal> {
  let hardTimer: NodeJS.Timeout | undefined;
  let terminationTimer: NodeJS.Timeout | undefined;
  let raceSettled = false;
  const hardDeadline = new Promise<SandboxUtilityProcessTerminal>((_resolve, reject) => {
    hardTimer = setTimeout(() => {
      reject(new Error('sandbox utility terminal exceeded host hard deadline'));
    }, input.hardDeadlineMs);
  });
  const terminationDeadline = input.terminationIntent.then(() => {
    if (raceSettled) return input.terminal;
    return new Promise<SandboxUtilityProcessTerminal>((_resolve, reject) => {
      terminationTimer = setTimeout(() => {
        reject(new Error('sandbox utility terminal exceeded host termination deadline'));
      }, input.terminationDeadlineMs);
    });
  });
  return Promise.race([input.terminal, hardDeadline, terminationDeadline]).finally(() => {
    raceSettled = true;
    if (hardTimer) clearTimeout(hardTimer);
    if (terminationTimer) clearTimeout(terminationTimer);
  });
}

function createRunToken(): string {
  return randomBytes(16).toString('hex');
}

function requireAbsolutePath(candidate: string, label: string): void {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute`);
}

function addSafeInteger(value: number, increment: number): number {
  const result = value + increment;
  if (!Number.isSafeInteger(result)) throw new Error('sandbox timeout exceeds safe integer range');
  return result;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
