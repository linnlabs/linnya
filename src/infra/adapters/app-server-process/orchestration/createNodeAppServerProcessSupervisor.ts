import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';

import type { JsonValue } from '@app/schemas';

import {
  APP_SERVER_CONTROL_MAX_FRAME_BYTES,
  APP_SERVER_CONTROL_SCHEMA_VERSION,
  encodeAppServerControlFrame,
  parseAppServerChildControlFrame,
  type AppServerControlRequestFrame,
  type AppServerControlStartupProgressFrame,
  type AppServerStartupProgress,
} from '../../../../app-hosts/linnya/app-server-control';
import {
  createAppServerRpcPeer,
  type AppServerRpcHandlerRegistry,
  type AppServerRpcPeer,
  type AppServerRpcRequestOptions,
} from '../../../../app-hosts/linnya/app-server-rpc';
import { createBoundedJsonLineDecoder } from '../../../../app-hosts/linnya/app-server-transport';
import { APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES } from '../../../../app-hosts/linnya/app-server-bootstrap';
import {
  AppServerStartupFailedError,
  type AppServerProcessIdentity,
  type AppServerProcessExit,
  type AppServerProcessLaunch,
  type AppServerProcessSupervisor,
} from '../definitions/appServerProcess';

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 5_000;
const MAX_PENDING_CONTROL_REQUESTS = 8;
// 启动期 child 因数据库等原因失败退出时，RPC pipe 可能先于 stdout 上的 fatal 帧报错（两条 pipe 互不保序）。
// ready 之前的传输失败先等这段时间：fatal 帧或进程退出先到，用户就看到真正原因。
const STARTUP_TRANSPORT_FAILURE_GRACE_MS = 2_000;

interface PendingRequest {
  readonly operation: AppServerControlRequestFrame['operation'];
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export function createNodeAppServerProcessSupervisor(input: {
  readonly launch: AppServerProcessLaunch;
  readonly rpcHandlers: AppServerRpcHandlerRegistry;
  readonly startTimeoutMs?: number;
  readonly controlTimeoutMs?: number;
  readonly idFactory?: { create(): string };
  readonly onStderr?: (text: string) => void;
  readonly stderrSink?: Writable;
  /** 启动期数据库阶段进度；Desktop 据此决定是否显示“正在升级数据”。 */
  readonly onStartupProgress?: (progress: AppServerStartupProgress) => void;
}): AppServerProcessSupervisor {
  assertLaunch(input.launch);
  const startTimeoutMs = input.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const controlTimeoutMs = input.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
  const idFactory = input.idFactory ?? { create: randomUUID };
  assertPositiveTimeout(startTimeoutMs, 'startTimeoutMs');
  assertPositiveTimeout(controlTimeoutMs, 'controlTimeoutMs');

  let child: ChildProcessWithoutNullStreams | null = null;
  let rpcPeer: AppServerRpcPeer | null = null;
  let rpcToChild: Writable | null = null;
  let identity: AppServerProcessIdentity | null = null;
  let startSettlement: Promise<AppServerProcessIdentity> | null = null;
  let shutdownSettlement: Promise<void> | null = null;
  let startResolve: ((value: AppServerProcessIdentity) => void) | null = null;
  let startReject: ((error: Error) => void) | null = null;
  let startTimeout: NodeJS.Timeout | null = null;
  // 数据库阶段（含数据格式升级）不计入启动超时：升级可能需要几分钟，中途终止只会让当前步骤
  // 回滚、下次启动重来。阶段前后各自适用完整的 startTimeoutMs。
  let databasePhase: 'pending' | 'active' | 'finished' = 'pending';
  let exitSettlement: Promise<void> | null = null;
  let exitResolve: (() => void) | null = null;
  let observedExitResolve: ((exit: AppServerProcessExit) => void) | null = null;
  const observedExit = new Promise<AppServerProcessExit>(resolve => {
    observedExitResolve = resolve;
  });
  const pending = new Map<string, PendingRequest>();
  let deferredStartupFailure: { readonly error: Error; readonly timer: NodeJS.Timeout } | null = null;

  const clearDeferredStartupFailure = (): Error | null => {
    if (!deferredStartupFailure) return null;
    clearTimeout(deferredStartupFailure.timer);
    const { error } = deferredStartupFailure;
    deferredStartupFailure = null;
    return error;
  };

  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };

  const failProtocol = (error: Error): void => {
    clearDeferredStartupFailure();
    clearStartTimeout();
    startReject?.(error);
    startReject = null;
    startResolve = null;
    rejectPending(error);
    rpcPeer?.dispose(error);
    rpcPeer = null;
    rpcToChild?.destroy(error);
    rpcToChild = null;
    child?.kill('SIGTERM');
  };

  /** RPC 或 bootstrap pipe 失败；ready 之前先等 fatal 帧或进程退出，ready 之后立即按协议失败处理。 */
  const failTransport = (error: Error): void => {
    if (identity || !startReject) {
      failProtocol(error);
      return;
    }
    if (deferredStartupFailure) return;
    deferredStartupFailure = {
      error,
      timer: setTimeout(() => failProtocol(error), STARTUP_TRANSPORT_FAILURE_GRACE_MS),
    };
  };

  const handleFrame = (value: unknown): void => {
    let frame;
    try {
      frame = parseAppServerChildControlFrame(value);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      failProtocol(new Error(`App Server 返回了无效控制帧：${detail}`));
      return;
    }
    if (frame.kind === 'fatal') {
      failProtocol(frame.code === 'startup_failed' && frame.startup_failure
        ? new AppServerStartupFailedError(frame.message, frame.startup_failure)
        : new Error(`App Server ${frame.code}: ${frame.message}`));
      return;
    }
    if (frame.kind === 'startup_progress') {
      handleStartupProgress(frame);
      return;
    }
    if (frame.kind === 'ready') {
      if (identity || !startResolve) {
        failProtocol(new Error('App Server 重复或越序发送 ready'));
        return;
      }
      identity = Object.freeze({
        daemonEpoch: frame.daemon_epoch,
        pid: frame.pid,
        applicationVersion: frame.application_version,
        apiPort: frame.api_port,
        rendererSessionToken: frame.renderer_session_token,
        databaseReady: frame.database_ready,
      });
      clearStartTimeout();
      startResolve(identity);
      startResolve = null;
      startReject = null;
      return;
    }
    const request = pending.get(frame.request_id);
    if (!request || request.operation !== frame.operation) {
      failProtocol(new Error('App Server response 没有匹配的控制请求'));
      return;
    }
    if (!identity || frame.daemon_epoch !== identity.daemonEpoch) {
      failProtocol(new Error('App Server response daemon epoch 不匹配'));
      return;
    }
    pending.delete(frame.request_id);
    clearTimeout(request.timeout);
    request.resolve();
  };

  const handleStartupProgress = (frame: AppServerControlStartupProgressFrame): void => {
    if (identity || !startResolve) {
      failProtocol(new Error('App Server 在启动阶段之外发送 startup_progress'));
      return;
    }
    const expectedPhase = frame.state === 'started' ? 'pending' : 'active';
    if (databasePhase !== expectedPhase) {
      failProtocol(new Error(`App Server startup_progress 越序：${frame.state}`));
      return;
    }
    if (frame.state === 'started') {
      databasePhase = 'active';
      clearStartTimeout();
    } else if (frame.state === 'finished') {
      databasePhase = 'finished';
      armStartTimeout();
    }
    input.onStartupProgress?.(Object.freeze({
      state: frame.state,
      upgrading: frame.upgrading,
      completedSteps: frame.completed_steps,
      totalSteps: frame.total_steps,
    }));
  };

  const armStartTimeout = (): void => {
    clearStartTimeout();
    startTimeout = setTimeout(() => {
      const failure = new Error(`App Server ready 超时（${startTimeoutMs}ms）`);
      failProtocol(failure);
    }, startTimeoutMs);
  };

  const clearStartTimeout = (): void => {
    if (!startTimeout) return;
    clearTimeout(startTimeout);
    startTimeout = null;
  };

  const start = (): Promise<AppServerProcessIdentity> => {
    if (startSettlement) return startSettlement;
    const launchedChild = spawn(
      input.launch.executablePath,
      [input.launch.entryPath, ...(input.launch.entryArguments ?? [])],
      {
        cwd: input.launch.workingDirectory,
        env: input.launch.environment,
        // fd 0/1 是 lifecycle；fd 3 是一次性 bootstrap；fd 4/5 是双向 RPC 的独立单向 pipe。
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: false,
      },
    );
    child = launchedChild;
    // 当前 @types/node 把 stdio tuple 截断在 fd 4；复制为运行时数组后才能无断言地读取 fd 5。
    const childStdio = [...launchedChild.stdio];
    const bootstrapInput = childStdio[3];
    const rpcFromChild = childStdio[4];
    const launchedRpcToChild = childStdio[5];
    if (!(bootstrapInput instanceof Writable)
      || !(rpcFromChild instanceof Readable)
      || !(launchedRpcToChild instanceof Writable)) {
      launchedChild.kill('SIGTERM');
      throw new Error('App Server bootstrap/RPC pipe 创建失败');
    }
    rpcToChild = launchedRpcToChild;
    rpcPeer = createAppServerRpcPeer({
      input: rpcFromChild,
      output: launchedRpcToChild,
      handlers: input.rpcHandlers,
    });
    void rpcPeer.completed.catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      failTransport(new Error(`App Server RPC 失败：${detail}`));
    });
    exitSettlement = new Promise<void>(resolve => {
      exitResolve = resolve;
    });
    const decoder = createBoundedJsonLineDecoder({
      protocolName: 'App Server control protocol',
      maxFrameBytes: APP_SERVER_CONTROL_MAX_FRAME_BYTES,
      onValue: handleFrame,
      onFailure: failProtocol,
    });
    launchedChild.stdout.on('data', chunk => {
      if (Buffer.isBuffer(chunk) || typeof chunk === 'string') decoder.push(chunk);
    });
    launchedChild.stdout.once('end', () => decoder.end());
    if (input.stderrSink) {
      // 生产 Desktop 直接连接 stream，避免在 Electron Main 对每个日志 chunk 做格式化与复制。
      launchedChild.stderr.pipe(input.stderrSink, { end: false });
    } else {
      launchedChild.stderr.on('data', chunk => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        input.onStderr?.(text);
      });
    }
    launchedChild.once('error', error => {
      failProtocol(new Error(`App Server process 启动失败：${error.message}`));
    });
    // spawn 失败没有 exit，但仍会 close；统一等待进程与 stdio 收口，避免失败后 shutdown 永久等待。
    launchedChild.once('close', (code, signal) => {
      clearStartTimeout();
      const deferredFailure = clearDeferredStartupFailure();
      exitResolve?.();
      exitResolve = null;
      observedExitResolve?.(Object.freeze({
        code,
        signal,
        expected: shutdownSettlement !== null,
      }));
      observedExitResolve = null;
      const failure = new Error(
        `App Server process 已退出：code=${String(code)} signal=${String(signal)}`,
      );
      rpcPeer?.dispose(failure);
      rpcPeer = null;
      rpcToChild = null;
      if (!identity) startReject?.(deferredFailure ?? failure);
      rejectPending(failure);
      child = null;
      identity = null;
    });

    startSettlement = new Promise<AppServerProcessIdentity>((resolve, reject) => {
      startResolve = resolve;
      startReject = reject;
      armStartTimeout();
    });
    launchedChild.once('spawn', () => {
      void writeBootstrapFrame(bootstrapInput, input.launch.bootstrapBytes).catch(error => {
        failTransport(error);
      });
    });
    return startSettlement;
  };

  const writeFrame = async (frame: AppServerControlRequestFrame): Promise<void> => {
    const activeChild = child;
    if (!activeChild || !identity || activeChild.stdin.destroyed) {
      throw new Error('App Server 尚未 ready 或已经退出');
    }
    const bytes = encodeAppServerControlFrame(frame);
    if (activeChild.stdin.write(bytes)) return;
    await new Promise<void>((resolve, reject) => {
      activeChild.stdin.once('drain', resolve);
      activeChild.stdin.once('error', reject);
    });
  };

  const requestControl = async (
    operation: AppServerControlRequestFrame['operation'],
  ): Promise<void> => {
    if (pending.size >= MAX_PENDING_CONTROL_REQUESTS) {
      throw new Error('App Server control 请求已达容量上限');
    }
    const requestId = idFactory.create();
    const settlement = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`App Server ${operation} 超时（${controlTimeoutMs}ms）`));
      }, controlTimeoutMs);
      pending.set(requestId, { operation, resolve, reject, timeout });
    });
    try {
      await writeFrame({
        schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
        kind: 'request',
        request_id: requestId,
        operation,
      });
    } catch (error: unknown) {
      const registered = pending.get(requestId);
      if (registered) clearTimeout(registered.timeout);
      pending.delete(requestId);
      throw error;
    }
    await settlement;
  };

  const shutdown = (): Promise<void> => {
    if (shutdownSettlement) return shutdownSettlement;
    shutdownSettlement = (async () => {
      const activeChild = child;
      if (!activeChild) return;
      const requiresCleanExit = identity !== null;
      let requestFailure: unknown;
      try {
        if (identity) await requestControl('shutdown');
      } catch (error: unknown) {
        requestFailure = error;
      } finally {
        rpcPeer?.dispose(new Error('App Server 正在关闭'));
        rpcPeer = null;
        rpcToChild?.end();
        rpcToChild = null;
        activeChild.stdin.end();
      }
      const exited = exitSettlement;
      if (exited) await waitForChildExit(activeChild, exited, controlTimeoutMs);
      if (requestFailure) throw requestFailure;
      const exit = await observedExit;
      if (requiresCleanExit && (exit.code !== 0 || exit.signal !== null)) {
        throw new Error(`App Server 未正常关停：code=${String(exit.code)} signal=${String(exit.signal)}`);
      }
    })();
    return shutdownSettlement;
  };

  return Object.freeze({
    start,
    waitForExit() {
      if (!startSettlement) throw new Error('App Server 尚未启动');
      return observedExit;
    },
    async request(
      method: string,
      payload: JsonValue,
      options?: AppServerRpcRequestOptions,
    ) {
      await start();
      const activeRpcPeer = rpcPeer;
      if (!activeRpcPeer) throw new Error('App Server RPC 尚未 ready 或已经退出');
      return activeRpcPeer.request(method, payload, options);
    },
    async ping() {
      await start();
      await requestControl('ping');
    },
    shutdown,
  });
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<void>,
  gracefulTimeoutMs: number,
): Promise<void> {
  if (await settleBeforeDeadline(exited, gracefulTimeoutMs)) return;
  child.kill('SIGTERM');
  if (await settleBeforeDeadline(exited, 1_000)) return;
  child.kill('SIGKILL');
  await exited;
}

function settleBeforeDeadline(settlement: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    void settlement.then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function assertLaunch(launch: AppServerProcessLaunch): void {
  if (!path.isAbsolute(launch.executablePath)
    || !path.isAbsolute(launch.entryPath)
    || !path.isAbsolute(launch.workingDirectory)) {
    throw new Error('App Server executable、entry 与 working directory 必须是绝对路径');
  }
  if (launch.bootstrapBytes.byteLength === 0
    || launch.bootstrapBytes.byteLength > APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES) {
    throw new Error(
      `App Server bootstrap frame 必须在 1-${APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES} bytes`,
    );
  }
}

function assertPositiveTimeout(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`App Server ${label} 必须是正整数`);
  }
}

async function writeBootstrapFrame(output: Writable, bytes: Uint8Array): Promise<void> {
  // end 的 callback 不消费 error 事件；finished 同时接纳失败，避免 EPIPE 成为未捕获异常。
  const completion = finished(output, { readable: false, cleanup: true });
  output.end(Buffer.from(bytes));
  await completion;
}
