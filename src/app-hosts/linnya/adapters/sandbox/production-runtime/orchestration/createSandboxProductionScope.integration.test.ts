import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('src/shared/logger', () => ({
  getLogger: () => ({ error: loggerErrorMock }),
}));

import type {
  SandboxRunnerRequest,
} from 'src/features/sandbox/definitions/sandboxRunner.js';
import type {
  SandboxRunnerEvaluationResult,
} from 'src/features/sandbox/runner-evaluation/definitions/sandboxRunnerEvaluation.js';
import {
  parseSandboxUtilityEnvelope,
  parseSandboxUtilityGeneration,
  parseSandboxUtilityHostPayload,
  type SandboxUtilityChildPayload,
  type SandboxUtilityGeneration,
  type SandboxUtilityHostPayload,
  type SandboxUtilitySettlementFailure,
  type SandboxUtilityTerminationCause,
} from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport.js';
import {
  publishSandboxResultMailbox,
  readSandboxRequestMailbox,
} from 'src/features/sandbox/runners/local-process/functions/sandboxMailboxFiles.js';
import type {
  SandboxUtilityProcessForkPort,
  SandboxUtilityProcessForkRequest,
} from '../definitions/sandboxUtilityProcessFork.js';
import type {
  SandboxUtilityProcessLike,
} from '../definitions/sandboxUtilityProcessTransport.js';
import { createSandboxProductionScope } from './createSandboxProductionScope.js';

const roots: string[] = [];
const EVALUATOR_PID = 2468;
const UTILITY_PID = 4321;

describe('Sandbox production scope', () => {
  afterEach(async () => {
    vi.useRealTimers();
    loggerErrorMock.mockReset();
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it('用真实 mailbox 完成正常执行，并在公开结果前删除本轮目录', async () => {
    const storageRoot = await createStorageRoot();
    let observedRequest: SandboxRunnerRequest | undefined;
    const harness = createUtilityForkHarness(controller => {
      controller.onHostPayload(async payload => {
        if (payload.kind !== 'sandbox_start') return;
        observedRequest = await readSandboxRequestMailbox({
          runDirectory: payload.runDirectory,
          runToken: payload.runToken,
        });
        await publishSandboxResultMailbox({
          runDirectory: payload.runDirectory,
          runToken: payload.runToken,
          result: successfulEvaluation(),
        });
        controller.publishCompletedRun(payload.runToken);
        controller.emitExit(0);
      });
      queueMicrotask(() => controller.publishReady());
    });
    const scope = createScope(storageRoot, harness.port);

    const result = await scope.execute(createRequest());

    expect(observedRequest).toEqual(createRequest());
    expect(result).toMatchObject({
      success: true,
      value: { answer: 42 },
      logs: ['sandbox evaluation completed'],
      stderr: 'evaluator diagnostic tail',
      diagnostics: {
        childPid: EVALUATOR_PID,
        protocolEvents: ['ready', 'started', 'result'],
      },
    });
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it('期限溢出在创建 Utility 前失败，不产生 run 目录', async () => {
    const storageRoot = await createStorageRoot();
    const harness = createUtilityForkHarness(() => undefined);
    const scope = createScope(storageRoot, harness.port);

    const result = await scope.execute(createRequest({ timeoutMs: Number.MAX_SAFE_INTEGER }));

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message: 'Sandbox runner 运行时通信失败。' },
      diagnostics: { cleanupStatus: 'succeeded' },
    });
    expect(harness.forkCount).toBe(0);
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it('terminal 与 exit 均缺失时有界失败，第二次 owner 重试观察 exit 后才删除残余目录', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const storageRoot = await createStorageRoot();
    const harness = createUtilityForkHarness(controller => {
      controller.onHostPayload(() => undefined);
      controller.onKill(killCount => {
        if (killCount === 3) queueMicrotask(() => controller.emitExit(0));
      });
      queueMicrotask(() => controller.publishReady());
    });
    const scope = createScope(storageRoot, harness.port);
    const execution = scope.execute(createRequest({ timeoutMs: 1 }));
    const controller = await waitForController(harness);
    await waitForHostPayload(controller, 'sandbox_start');

    await vi.advanceTimersByTimeAsync(15_251);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await execution;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message: 'Sandbox runner 运行时通信失败。' },
      diagnostics: { cleanupStatus: 'failed' },
    });
    expect(controller.killCount).toBe(1);
    expect(await readdir(storageRoot)).toHaveLength(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      '[SandboxRuntime] resource settlement incomplete',
      {
        runId: 'sandbox-run-1',
        utilityForked: true,
        utilityExitObserved: false,
        residualCleanupPending: true,
        cleanupStatus: 'failed',
      },
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('sandbox utility process');

    const firstOwnerAttempt = scope.endOwnerAndWait();
    const firstOwnerFailure = expect(firstOwnerAttempt).rejects.toThrow(
      'sandbox utility process did not exit after kill',
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2_000);
    await firstOwnerFailure;
    expect(controller.killCount).toBe(2);
    expect(await readdir(storageRoot)).toHaveLength(1);

    await scope.endOwnerAndWait();

    expect(controller.killCount).toBe(3);
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it('运行目录删除失败时返回稳定清理状态，并由 App owner 精确重试', async () => {
    const storageRoot = await createStorageRoot();
    let removalAttempts = 0;
    const harness = createUtilityForkHarness(controller => {
      controller.onHostPayload(async payload => {
        if (payload.kind !== 'sandbox_start') return;
        await publishSandboxResultMailbox({
          runDirectory: payload.runDirectory,
          runToken: payload.runToken,
          result: successfulEvaluation(),
        });
        controller.publishCompletedRun(payload.runToken);
        controller.emitExit(0);
      });
      queueMicrotask(() => controller.publishReady());
    });
    const scope = createScope(storageRoot, harness.port, async runDirectory => {
      removalAttempts += 1;
      if (removalAttempts === 1) throw new Error(`/secret/${runDirectory}/busy`);
      await rm(runDirectory, { recursive: true, force: true });
    });

    const result = await scope.execute(createRequest());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message: 'Sandbox runner 运行时通信失败。' },
      diagnostics: { cleanupStatus: 'failed' },
    });
    expect(removalAttempts).toBe(1);
    expect(await readdir(storageRoot)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('/secret/');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('/secret/');

    await scope.endOwnerAndWait();

    expect(removalAttempts).toBe(2);
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it('Utility 次生资源清理失败穿过生产 transport，但不改写超时首因', async () => {
    const storageRoot = await createStorageRoot();
    const harness = createUtilityForkHarness(controller => {
      controller.onHostPayload(async payload => {
        if (payload.kind !== 'sandbox_start') return;
        // Utility 只会在 start ACK 已返回后启动 Evaluator 并发布运行帧。
        await Promise.resolve();
        controller.publishTerminal(payload.runToken, {
          cause: 'timed_out',
          settlementFailures: ['tree_empty_failed', 'resource_release_failed'],
        });
        // 真实 Utility 会先让 terminal ACK 完成，再进入退出阶段；fake 也保持同一顺序，
        // 避免把测试自身的同步重入误当成生产 transport failure。
        queueMicrotask(() => controller.emitExit(0));
      });
      queueMicrotask(() => controller.publishReady());
    });
    const scope = createScope(storageRoot, harness.port);

    const result = await scope.execute(createRequest());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'timeout', message: 'Sandbox runner 超时终止（>2000ms）。' },
      diagnostics: { cleanupStatus: 'failed' },
    });
    expect(await readdir(storageRoot)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('tree_empty_failed');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('tree_empty_failed');
    await expect(scope.endOwnerAndWait()).resolves.toBeUndefined();
  });

  it('ready 前结束 owner 时只发送 owner end，不发送 start', async () => {
    const storageRoot = await createStorageRoot();
    const harness = createUtilityForkHarness(controller => {
      controller.onHostPayload(payload => {
        if (payload.kind === 'sandbox_owner_end') {
          // fake 的 postMessage 会同步回 ACK；多跨一个微任务，保证 host 先把 ACK
          // 结算为 accepted owner_end，再观察 Utility 的正常退出。
          queueMicrotask(() => queueMicrotask(() => controller.emitExit(0)));
        }
      });
    });
    const scope = createScope(storageRoot, harness.port);
    const execution = scope.execute(createRequest());
    const controller = await waitForController(harness);

    const ownerSettlement = scope.endOwnerAndWait();
    controller.publishReady();
    const result = await execution;
    await ownerSettlement;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message: 'Sandbox runner 因宿主结束而终止。' },
    });
    expect(controller.hostPayloads.map(payload => payload.kind)).toEqual([
      'sandbox_owner_end',
    ]);
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it('owner 已观察到 Utility 非零退出且目录已删时只报告执行失败', async () => {
    const storageRoot = await createStorageRoot();
    const harness = createUtilityForkHarness(controller => {
      controller.onHostPayload(payload => {
        if (payload.kind === 'sandbox_owner_end') {
          queueMicrotask(() => queueMicrotask(() => controller.emitExit(1)));
        }
      });
    });
    const scope = createScope(storageRoot, harness.port);
    const execution = scope.execute(createRequest());
    const controller = await waitForController(harness);

    const ownerSettlement = scope.endOwnerAndWait();
    controller.publishReady();
    const result = await execution;
    await ownerSettlement;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message: 'Sandbox runner 运行时通信失败。' },
      diagnostics: { cleanupStatus: 'succeeded' },
    });
    expect(await readdir(storageRoot)).toEqual([]);
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('terminal 先完成、同一微任务窗口内迟到 abort 时不遗留 termination timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const storageRoot = await createStorageRoot();
    const abortController = new AbortController();
    const harness = createUtilityForkHarness(controller => {
      controller.onHostPayload(async payload => {
        if (payload.kind !== 'sandbox_start') return;
        await publishSandboxResultMailbox({
          runDirectory: payload.runDirectory,
          runToken: payload.runToken,
          result: successfulEvaluation(),
        });
        controller.publishCompletedRun(payload.runToken);
        // terminal 已经被 host 接纳，但 production scope 尚未进入下一段 continuation。
        queueMicrotask(() => abortController.abort());
      });
      queueMicrotask(() => controller.publishReady());
    });
    const scope = createScope(storageRoot, harness.port);
    const execution = scope.execute(createRequest(), { abortSignal: abortController.signal });
    const controller = await waitForController(harness);
    await waitUntil(() => controller.terminalPublished);
    await flushMicrotasks();
    controller.emitExit(0);

    const result = await execution;

    expect(result.success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(await readdir(storageRoot)).toEqual([]);
  });
});

interface FakeUtilityController {
  readonly process: SandboxUtilityProcessLike;
  readonly hostPayloads: readonly SandboxUtilityHostPayload[];
  readonly killCount: number;
  readonly terminalPublished: boolean;
  onHostPayload(handler: (payload: SandboxUtilityHostPayload) => void | Promise<void>): void;
  onKill(handler: (killCount: number) => void): void;
  publishReady(): void;
  publishCompletedRun(runToken: string): void;
  publishTerminal(runToken: string, input: {
    readonly cause: SandboxUtilityTerminationCause;
    readonly settlementFailures: readonly SandboxUtilitySettlementFailure[];
  }): void;
  emitExit(exitCode: number): void;
}

interface UtilityForkHarness {
  readonly port: SandboxUtilityProcessForkPort;
  readonly controllers: readonly FakeUtilityController[];
  readonly forkCount: number;
}

function createUtilityForkHarness(
  configure: (controller: FakeUtilityController) => void,
): UtilityForkHarness {
  const controllers: FakeUtilityController[] = [];
  let forkCount = 0;
  return {
    port: {
      fork(request) {
        forkCount += 1;
        const generation = readGeneration(request);
        const controller = createFakeUtilityController(generation);
        controllers.push(controller);
        configure(controller);
        return controller.process;
      },
    },
    controllers,
    get forkCount() { return forkCount; },
  };
}

function createFakeUtilityController(
  generation: SandboxUtilityGeneration,
): FakeUtilityController {
  const stderr = new PassThrough();
  const hostPayloads: SandboxUtilityHostPayload[] = [];
  let messageListener: (message: unknown) => void = () => undefined;
  let exitListener: (exitCode: number) => void = () => undefined;
  let errorListener: (error: Error) => void = () => undefined;
  let hostPayloadHandler: (
    payload: SandboxUtilityHostPayload,
  ) => void | Promise<void> = () => undefined;
  let killHandler: (killCount: number) => void = () => undefined;
  let nextChildMessageId = 0;
  let killCount = 0;
  let terminalPublished = false;

  function publish(payload: SandboxUtilityChildPayload): void {
    messageListener({
      kind: 'sandbox_utility_message',
      generation,
      messageId: nextChildMessageId,
      payload,
    });
    nextChildMessageId += 1;
  }

  const process: SandboxUtilityProcessLike = {
    stderr,
    postMessage(message) {
      const envelope = parseSandboxUtilityEnvelope(message);
      if (envelope.generation !== generation || envelope.kind === 'sandbox_utility_ack') return;
      const payload = parseSandboxUtilityHostPayload(envelope.payload);
      hostPayloads.push(payload);
      messageListener({
        kind: 'sandbox_utility_ack',
        generation,
        messageId: envelope.messageId,
      });
      void Promise.resolve(hostPayloadHandler(payload)).catch(() => {
        errorListener(new Error('host payload handler failed'));
      });
    },
    kill() {
      killCount += 1;
      killHandler(killCount);
      return true;
    },
    onMessage(listener) { messageListener = listener; },
    onceExit(listener) { exitListener = listener; },
    onceError(listener) { errorListener = listener; },
  };

  return {
    process,
    hostPayloads,
    get killCount() { return killCount; },
    get terminalPublished() { return terminalPublished; },
    onHostPayload(handler) { hostPayloadHandler = handler; },
    onKill(handler) { killHandler = handler; },
    publishReady() {
      publish({ kind: 'sandbox_utility_ready', utilityPid: UTILITY_PID });
    },
    publishCompletedRun(runToken) {
      this.publishTerminal(runToken, {
        cause: 'natural',
        settlementFailures: [],
      });
    },
    publishTerminal(runToken, input) {
      const frames = ['ready', 'started', 'result_committed'] as const;
      for (const frame of frames) {
        publish({
          kind: 'sandbox_evaluator_frame',
          runToken,
          frame,
          evaluatorPid: EVALUATOR_PID,
        });
      }
      publish({
        kind: 'sandbox_terminal',
        runToken,
        cause: input.cause,
        rootExit: { exitCode: 0, signal: null },
        control: {
          acceptedFrames: frames,
          evaluatorPid: EVALUATOR_PID,
          windowsCrLfPreambleObserved: false,
          completed: true,
        },
        stderrBytes: 22,
        stderrTail: 'evaluator diagnostic tail',
        settlementFailures: input.settlementFailures,
      });
      terminalPublished = true;
    },
    emitExit(exitCode) { exitListener(exitCode); },
  };
}

function createScope(
  storageRoot: string,
  utilityProcessFork: SandboxUtilityProcessForkPort,
  removeRunDirectory?: (runDirectory: string) => Promise<void>,
) {
  return createSandboxProductionScope({
    storageRoot,
    utilityPath: path.join(storageRoot, 'sandbox-utility.cjs'),
    utilityEnvironment: { PATH: '/usr/bin:/bin' },
    evaluator: {
      executablePath: process.execPath,
      entryPath: path.resolve('sandboxEvaluatorProcess.cjs'),
      environment: { PATH: '/usr/bin:/bin' },
    },
    platformRuntime: { schema_version: 1, platform: 'darwin' },
    utilityProcessFork,
    ...(removeRunDirectory ? { removeRunDirectory } : {}),
  });
}

function createRequest(
  limitOverrides: Partial<SandboxRunnerRequest['limits']> = {},
): SandboxRunnerRequest {
  return {
    runId: 'sandbox-run-1',
    profileId: 'slides',
    language: 'javascript',
    source: 'return 42;',
    globals: { input: 'value' },
    bindings: [],
    limits: {
      timeoutMs: 2_000,
      maxLogLines: 100,
      maxLogLineLength: 4_096,
      maxResultBytes: 1_048_576,
      maxSourceBytes: 1_048_576,
      maxCapabilityPayloadBytes: 1_048_576,
      maxHeapMb: 128,
      idleTimeoutMs: 2_000,
      ...limitOverrides,
    },
    capabilities: [],
  };
}

function successfulEvaluation(): SandboxRunnerEvaluationResult {
  return {
    success: true,
    value: { answer: 42 },
    logs: ['sandbox evaluation completed'],
    elapsedMs: 12,
    capabilityCalls: [],
    deniedActions: [],
  };
}

function readGeneration(
  request: SandboxUtilityProcessForkRequest,
): SandboxUtilityGeneration {
  const candidate = request.argv[0];
  if (candidate === undefined) throw new Error('sandbox utility generation argv is missing');
  return parseSandboxUtilityGeneration(candidate);
}

async function createStorageRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-sandbox-production-scope-'));
  roots.push(root);
  return root;
}

async function waitForController(
  harness: UtilityForkHarness,
): Promise<FakeUtilityController> {
  await waitUntil(() => harness.controllers.length > 0);
  const controller = harness.controllers[0];
  if (!controller) throw new Error('sandbox fake Utility was not created');
  return controller;
}

async function waitForHostPayload(
  controller: FakeUtilityController,
  kind: SandboxUtilityHostPayload['kind'],
): Promise<void> {
  await waitUntil(() => controller.hostPayloads.some(payload => payload.kind === kind));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    // mailbox 使用真实文件系统；这里只轮询微任务会饿死 libuv 的完成回调。
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('sandbox production scope test condition did not settle');
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}
