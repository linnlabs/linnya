import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SandboxUtilityChildPayload } from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport';
import type {
  SandboxUtilityProcessLike,
  SandboxUtilityStartPayload,
} from '../definitions/sandboxUtilityProcessTransport';
import { createSandboxUtilityProcessTransport } from '../functions/createSandboxUtilityProcessTransport';

const GENERATION = '12345678-1234-4234-8234-123456789abc';
const STALE_GENERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_TOKEN = '0'.repeat(32);
const EVALUATOR_PID = 2468;

describe('Sandbox Utility process transport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ready 前冻结 start，接纳并 ACK ready 后才发送 start，且 start ACK 不冒充 terminal', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    const start = transport.sendStart(createStartPayload());

    expect(child.posted).toEqual([]);
    child.emitMessage(messageEnvelope(0, readyPayload(), STALE_GENERATION));
    expect(child.posted).toEqual([]);
    child.emitMessage(messageEnvelope(0, readyPayload()));
    await expect(transport.waitUntilReady()).resolves.toBe(4321);
    await flushMicrotasks();

    expect(child.posted).toEqual([
      acknowledgementEnvelope(0),
      hostMessageEnvelope(0, createStartPayload()),
    ]);
    child.emitMessage(acknowledgementEnvelope(0));
    await expect(start).resolves.toBeUndefined();

    let terminalSettled = false;
    void transport.waitForTerminal().finally(() => {
      terminalSettled = true;
    });
    await flushMicrotasks();
    expect(terminalSettled).toBe(false);
  });

  it('start 与 cancel 都在 ready 前挂起时，必须先完成 cancel ACK 再发送 start', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    const start = transport.sendStart(createStartPayload());
    const cancel = transport.sendCancel(RUN_TOKEN);

    child.emitMessage(messageEnvelope(0, readyPayload()));
    await flushMicrotasks();
    expect(readPostedHostPayloads(child)).toEqual([
      { kind: 'sandbox_cancel', runToken: RUN_TOKEN },
    ]);

    child.emitMessage(acknowledgementEnvelope(0));
    await expect(cancel).resolves.toBeUndefined();
    await flushMicrotasks();
    expect(readPostedHostPayloads(child)).toEqual([
      { kind: 'sandbox_cancel', runToken: RUN_TOKEN },
      createStartPayload(),
    ]);

    child.emitMessage(acknowledgementEnvelope(1));
    await expect(start).resolves.toBeUndefined();
    child.emitMessage(messageEnvelope(1, terminalPayload('cancelled', [])));

    await expect(transport.waitForTerminal()).resolves.toMatchObject({
      utilityPid: 4321,
      evaluatorFrames: [],
      terminal: { cause: 'cancelled', settlementFailures: [] },
    });
    child.emitExit(0);
    await expect(transport.waitForExit()).resolves.toMatchObject({ exitCode: 0 });
  });

  it('start 挂起期间 owner end 胜出，ready 后只发送 owner end 并拒绝 start', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    const start = transport.sendStart(createStartPayload()).catch(toError);
    const ownerEnd = transport.endOwner();

    child.emitMessage(messageEnvelope(0, readyPayload()));
    await flushMicrotasks();
    expect(readPostedHostPayloads(child)).toEqual([{ kind: 'sandbox_owner_end' }]);
    child.emitMessage(acknowledgementEnvelope(0));

    await expect(ownerEnd).resolves.toBeUndefined();
    await expect(start).resolves.toMatchObject({ message: 'sandbox utility owner has ended' });
    expect(readPostedHostPayloads(child)).toHaveLength(1);

    const terminal = transport.waitForTerminal().catch(toError);
    child.emitExit(0);
    await expect(terminal).resolves.toMatchObject({
      message: 'sandbox utility process exited: 0',
    });
    await expect(transport.waitForExit()).resolves.not.toHaveProperty('transportFailure');
  });

  it('拒绝 ready 前事件与重复 ready，并且不 ACK 未接纳的消息', async () => {
    const beforeReady = createFakeUtilityProcess();
    const beforeReadyTransport = createTransport(beforeReady);
    beforeReady.emitMessage(messageEnvelope(0, evaluatorFramePayload('ready')));

    await expect(beforeReadyTransport.waitUntilReady()).rejects.toThrow('event before ready');
    expect(beforeReady.killCount).toBe(1);
    expect(beforeReady.posted).toEqual([]);

    const duplicate = createFakeUtilityProcess();
    const duplicateTransport = createTransport(duplicate);
    duplicate.emitMessage(messageEnvelope(0, readyPayload()));
    await expect(duplicateTransport.waitUntilReady()).resolves.toBe(4321);
    duplicate.emitMessage(messageEnvelope(1, readyPayload()));

    await expect(duplicateTransport.waitForTerminal()).rejects.toThrow(
      'published ready more than once'
    );
    expect(duplicate.killCount).toBe(1);
    expect(duplicate.posted).toEqual([acknowledgementEnvelope(0)]);
  });

  it('即使 ready 已接纳，start 尚未真正发出时也拒绝提前到达的 run 事件', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    const start = transport.sendStart(createStartPayload()).catch(toError);

    child.emitMessage(messageEnvelope(0, readyPayload()));
    // intent dispatch 在 microtask 串行执行；当前同步栈内 start 尚未写入 Utility。
    child.emitMessage(messageEnvelope(1, evaluatorFramePayload('ready')));

    await expect(transport.waitForTerminal()).rejects.toThrow('run event before start');
    await expect(start).resolves.toMatchObject({
      message: expect.stringContaining('run event before start'),
    });
    expect(child.killCount).toBe(1);
    expect(readPostedHostPayloads(child)).toEqual([]);
  });

  it('严格收集三帧与 terminal，terminal 后任何当前 generation 事件都会关闭 transport', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    await establishStartedTransport(child, transport);

    const frames = ['ready', 'started', 'result_committed'] as const;
    frames.forEach((frame, index) => {
      child.emitMessage(messageEnvelope(index + 1, evaluatorFramePayload(frame)));
    });
    child.emitMessage(messageEnvelope(4, terminalPayload('natural', frames)));

    await expect(transport.waitForTerminal()).resolves.toMatchObject({
      utilityPid: 4321,
      evaluatorFrames: frames.map(frame => ({ frame, evaluatorPid: EVALUATOR_PID })),
      terminal: {
        cause: 'natural',
        control: { completed: true, evaluatorPid: EVALUATOR_PID },
      },
    });

    child.emitMessage(messageEnvelope(5, terminalPayload('natural', frames)));
    expect(child.killCount).toBe(1);
    child.emitExit(1);
    await expect(transport.waitForExit()).resolves.toMatchObject({
      exitCode: 1,
      transportFailure: { message: 'sandbox utility process published an event after terminal' },
    });
  });

  it('拒绝乱序 Evaluator frame，并保留首个 transport failure 到 Utility exit', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    await establishStartedTransport(child, transport);
    const terminal = transport.waitForTerminal().catch(toError);

    child.emitMessage(messageEnvelope(1, evaluatorFramePayload('started')));
    await expect(terminal).resolves.toMatchObject({
      message: expect.stringContaining('evaluator frame sequence mismatch'),
    });
    expect(child.killCount).toBe(1);

    child.emitExit(9);
    await expect(transport.waitForExit()).resolves.toMatchObject({
      exitCode: 9,
      transportFailure: {
        message: expect.stringContaining('evaluator frame sequence mismatch'),
      },
    });
  });

  it('忽略旧 generation，owner end 等待 ready 的期限到达后失败并终止 Utility', async () => {
    vi.useFakeTimers();
    const child = createFakeUtilityProcess();
    const transport = createTransport(child, { readyDeadlineMs: 20 });
    const ownerEnd = transport.endOwner().catch(toError);
    const ready = transport.waitUntilReady().catch(toError);

    child.emitMessage(messageEnvelope(0, readyPayload(), STALE_GENERATION));
    expect(child.posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);

    await expect(ownerEnd).resolves.toMatchObject({
      message: 'sandbox utility process did not publish ready before deadline',
    });
    await expect(ready).resolves.toMatchObject({
      message: 'sandbox utility process did not publish ready before deadline',
    });
    expect(child.killCount).toBe(1);
  });

  it('stderr 从创建时持续排空，只在 exit 保留完整 byte 数和最后 64 KiB', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    child.emitMessage(messageEnvelope(0, readyPayload()));
    const ownerEnd = transport.endOwner();
    await flushMicrotasks();
    child.emitMessage(acknowledgementEnvelope(0));
    await ownerEnd;

    const prefix = Buffer.alloc(4 * 1024, 0x61);
    const pressure = Buffer.alloc(70 * 1024, 0x62);
    const suffix = Buffer.from('utility-final-tail');
    child.stderr.write(prefix);
    child.stderr.write(pressure);
    child.stderr.end(suffix);
    child.emitExit(0);

    const expectedTail = Buffer.concat([pressure, suffix]).subarray(-(64 * 1024));
    const exit = await transport.waitForExit();
    expect(exit).toMatchObject({
      exitCode: 0,
      stderrBytes: prefix.byteLength + pressure.byteLength + suffix.byteLength,
      stderrTail: expectedTail.toString('utf8'),
    });
    expect(Buffer.byteLength(exit.stderrTail, 'utf8')).toBe(64 * 1024);
  });

  it('killAndWait 不暴露 child，并等待真实 exit 后才结算', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    const killed = transport.killAndWait();
    expect(child.killCount).toBe(1);

    let settled = false;
    void killed.finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    child.emitExit(7);
    await expect(killed).resolves.toMatchObject({
      exitCode: 7,
      transportFailure: { message: 'sandbox utility process exited: 7' },
    });
  });

  it('宿主 child error 触发一次终止，并保留为 exit 的首个 transport failure', async () => {
    const child = createFakeUtilityProcess();
    const transport = createTransport(child);
    const ready = transport.waitUntilReady().catch(toError);
    const terminal = transport.waitForTerminal().catch(toError);

    child.emitError();
    await expect(ready).resolves.toMatchObject({
      message: 'sandbox utility process fatal error',
    });
    await expect(terminal).resolves.toMatchObject({
      message: 'sandbox utility process fatal error',
    });
    expect(child.killCount).toBe(1);

    await expect(transport.sendStart(createStartPayload())).rejects.toThrow(
      'sandbox utility process fatal error'
    );
    await expect(transport.endOwner()).rejects.toThrow('sandbox utility process fatal error');

    child.emitExit(1);
    await expect(transport.waitForExit()).resolves.toMatchObject({
      exitCode: 1,
      transportFailure: {
        message: 'sandbox utility process fatal error',
      },
    });
  });

  it('terminal ACK 后 Utility 不退出时先 kill，kill 后仍无 exit 则有界失败且可重试收口', async () => {
    vi.useFakeTimers();
    const child = createFakeUtilityProcess();
    const transport = createTransport(child, { exitDeadlineMs: 20 });
    await establishStartedTransport(child, transport);
    const frames = ['ready', 'started', 'result_committed'] as const;
    frames.forEach((frame, index) => {
      child.emitMessage(messageEnvelope(index + 1, evaluatorFramePayload(frame)));
    });
    child.emitMessage(messageEnvelope(4, terminalPayload('natural', frames)));
    await transport.waitForTerminal();
    const exit = transport.waitForExit().catch(toError);

    await vi.advanceTimersByTimeAsync(20);
    expect(child.killCount).toBe(1);
    await vi.advanceTimersByTimeAsync(20);
    await expect(exit).resolves.toMatchObject({
      message: 'sandbox utility process did not exit after kill',
    });

    await flushMicrotasks();
    const retry = transport.killAndWait();
    expect(child.killCount).toBe(2);
    child.emitExit(0);
    await expect(retry).resolves.toMatchObject({
      exitCode: 0,
      transportFailure: {
        message: 'sandbox utility process did not exit after terminal or owner end',
      },
    });
  });

  it('terminal 后依赖强杀才得到 exit 0 时仍保留优雅退出超时首因', async () => {
    vi.useFakeTimers();
    const child = createFakeUtilityProcess();
    const transport = createTransport(child, { exitDeadlineMs: 20 });
    await establishStartedTransport(child, transport);
    const frames = ['ready', 'started', 'result_committed'] as const;
    frames.forEach((frame, index) => {
      child.emitMessage(messageEnvelope(index + 1, evaluatorFramePayload(frame)));
    });
    child.emitMessage(messageEnvelope(4, terminalPayload('natural', frames)));
    await transport.waitForTerminal();
    const exit = transport.waitForExit();

    await vi.advanceTimersByTimeAsync(20);
    expect(child.killCount).toBe(1);
    child.emitExit(0);
    await expect(exit).resolves.toMatchObject({
      exitCode: 0,
      transportFailure: {
        message: 'sandbox utility process did not exit after terminal or owner end',
      },
    });
  });

  it('kill 已接受但 exit 永不到达时，killAndWait 在固定期限内明确失败', async () => {
    vi.useFakeTimers();
    const child = createFakeUtilityProcess();
    const transport = createTransport(child, { exitDeadlineMs: 20 });
    const killed = transport.killAndWait().catch(toError);

    expect(child.killCount).toBe(1);
    await vi.advanceTimersByTimeAsync(20);
    await expect(killed).resolves.toMatchObject({
      message: 'sandbox utility process did not exit after kill',
    });
  });
});

function createTransport(
  child: ReturnType<typeof createFakeUtilityProcess>,
  options: {
    readonly readyDeadlineMs?: number;
    readonly exitDeadlineMs?: number;
  } = {}
) {
  return createSandboxUtilityProcessTransport({
    child: child.process,
    generation: GENERATION,
    acknowledgementDeadlineMs: 100,
    readyDeadlineMs: options.readyDeadlineMs ?? 100,
    exitDeadlineMs: options.exitDeadlineMs ?? 100,
  });
}

function createFakeUtilityProcess() {
  const stderr = new PassThrough();
  const posted: unknown[] = [];
  let messageListener: (message: unknown) => void = () => {};
  let exitListener: (exitCode: number) => void = () => {};
  let errorListener: (error: Error) => void = () => {};
  let killCount = 0;
  const process: SandboxUtilityProcessLike = {
    stderr,
    postMessage(message) {
      posted.push(message);
    },
    kill() {
      killCount += 1;
      return true;
    },
    onMessage(listener) {
      messageListener = listener;
    },
    onceExit(listener) {
      exitListener = listener;
    },
    onceError(listener) {
      errorListener = listener;
    },
  };
  return {
    process,
    stderr,
    posted,
    get killCount() {
      return killCount;
    },
    emitMessage(message: unknown) {
      messageListener(message);
    },
    emitExit(exitCode: number) {
      exitListener(exitCode);
    },
    emitError() {
      errorListener(new Error('sandbox utility process fatal error'));
    },
  };
}

async function establishStartedTransport(
  child: ReturnType<typeof createFakeUtilityProcess>,
  transport: ReturnType<typeof createTransport>
): Promise<void> {
  const start = transport.sendStart(createStartPayload());
  child.emitMessage(messageEnvelope(0, readyPayload()));
  await flushMicrotasks();
  child.emitMessage(acknowledgementEnvelope(0));
  await start;
}

function createStartPayload(): SandboxUtilityStartPayload {
  return {
    kind: 'sandbox_start',
    runToken: RUN_TOKEN,
    runDirectory: path.resolve('sandbox-utility-run'),
    timeoutMs: 10_000,
    idleTimeoutMs: 12_000,
    maximumHeapMb: 128,
    evaluator: {
      executablePath: path.resolve('sandbox-evaluator'),
      entryPath: path.resolve('sandboxEvaluatorProcess.cjs'),
      environment: { PATH: '/usr/bin:/bin' },
    },
  };
}

function readyPayload(): SandboxUtilityChildPayload {
  return { kind: 'sandbox_utility_ready', utilityPid: 4321 };
}

function evaluatorFramePayload(
  frame: 'ready' | 'started' | 'result_committed'
): SandboxUtilityChildPayload {
  return {
    kind: 'sandbox_evaluator_frame',
    runToken: RUN_TOKEN,
    frame,
    evaluatorPid: EVALUATOR_PID,
  };
}

function terminalPayload(
  cause: 'natural' | 'cancelled',
  frames: readonly ('ready' | 'started' | 'result_committed')[]
): SandboxUtilityChildPayload {
  return {
    kind: 'sandbox_terminal',
    runToken: RUN_TOKEN,
    cause,
    ...(cause === 'natural' ? { rootExit: { exitCode: 0, signal: null } } : {}),
    control: {
      acceptedFrames: [...frames],
      ...(frames.length > 0 ? { evaluatorPid: EVALUATOR_PID } : {}),
      windowsCrLfPreambleObserved: false,
      completed: frames.length === 3,
    },
    stderrBytes: 0,
    stderrTail: '',
    settlementFailures: [],
  };
}

function messageEnvelope(
  messageId: number,
  payload: SandboxUtilityChildPayload,
  generation = GENERATION
): unknown {
  return {
    kind: 'sandbox_utility_message',
    generation,
    messageId,
    payload,
  };
}

function hostMessageEnvelope(messageId: number, payload: unknown): unknown {
  return {
    kind: 'sandbox_utility_message',
    generation: GENERATION,
    messageId,
    payload,
  };
}

function acknowledgementEnvelope(messageId: number): unknown {
  return {
    kind: 'sandbox_utility_ack',
    generation: GENERATION,
    messageId,
  };
}

function readPostedHostPayloads(child: ReturnType<typeof createFakeUtilityProcess>): unknown[] {
  return child.posted.flatMap(message => {
    if (!isRecord(message) || Reflect.get(message, 'kind') !== 'sandbox_utility_message') return [];
    return [Reflect.get(message, 'payload')];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
