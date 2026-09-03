import {
  parseSandboxUtilityChildPayload,
  parseSandboxUtilityGeneration,
  parseSandboxUtilityHostPayload,
  type SandboxUtilityChildPayload,
} from '../../../../../features/sandbox/runners/local-process/definitions/sandboxUtilityTransport.js';
import type {
  AcknowledgedSandboxUtilityTransport,
} from '../../../../../features/sandbox/runners/local-process/functions/createAcknowledgedSandboxUtilityTransport.js';
import {
  createAcknowledgedSandboxUtilityTransport,
} from '../../../../../features/sandbox/runners/local-process/functions/createAcknowledgedSandboxUtilityTransport.js';
import {
  runSandboxUtilityProcess,
  type SandboxUtilityProcessRun,
} from '../../../../../features/sandbox/runners/local-process/orchestration/runSandboxUtilityProcess.js';
import {
  parseSerializedLocalProcessPlatformRuntime,
} from '../../../local-process-runtime/platform-runtime/index.js';
import {
  createLocalProcessPlatformLauncher,
} from '../../../local-process-runtime/production-runtime/index.js';

const electronParentPort = process.parentPort;
const nodeParentSend = process.send?.bind(process);
if (!electronParentPort && !nodeParentSend) {
  throw new Error('sandbox utility process requires an Electron or Node parent channel');
}

const generation = parseSandboxUtilityGeneration(process.argv[2]);
const platformRuntime = parseSerializedLocalProcessPlatformRuntime(process.argv[3]);
const launchOwnedProcess = createLocalProcessPlatformLauncher(platformRuntime);
let transport: AcknowledgedSandboxUtilityTransport<SandboxUtilityChildPayload> | undefined;
let run: SandboxUtilityProcessRun | undefined;
let acceptedRunToken: string | undefined;
let pendingCancelToken: string | undefined;
let ownerEnded = false;
let exitScheduled = false;
let utilityFailed = false;

function scheduleExit(exitCode: number): void {
  if (exitScheduled) return;
  exitScheduled = true;
  // ACK 必须先离开当前 message 调用栈；同步 exit 会让对端把已接纳消息误判为失败。
  setImmediate(() => process.exit(exitCode));
}

function failTransport(reason?: unknown): void {
  utilityFailed = true;
  if (reason !== undefined) {
    const message = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[sandbox-utility] unhandled rejection: ${message}\n`);
  }
  if (run) run.terminate('transport_failed');
  else scheduleExit(1);
}

function postParentMessage(message: unknown): void {
  if (electronParentPort) {
    electronParentPort.postMessage(message);
    return;
  }
  if (!nodeParentSend || !process.connected) {
    throw new Error('sandbox utility Node parent channel is unavailable');
  }
  if (!isNodeIpcSerializable(message)) {
    throw new Error('sandbox utility attempted to send a non-serializable root value');
  }
  nodeParentSend(message, (error: Error | null) => {
    if (error) failTransport(error);
  });
}

function isNodeIpcSerializable(
  value: unknown,
): value is string | object | number | boolean | bigint {
  return value !== null && (
    typeof value === 'object'
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  );
}

function subscribeToParentMessages(listener: (message: unknown) => void): void {
  if (electronParentPort) {
    electronParentPort.on('message', event => listener(event.data));
    return;
  }
  process.on('message', listener);
}

function acceptStart(payload: Extract<
  ReturnType<typeof parseSandboxUtilityHostPayload>,
  { readonly kind: 'sandbox_start' }
>): void {
  if (ownerEnded) throw new Error('sandbox utility owner has ended');
  if (acceptedRunToken) throw new Error('sandbox utility accepts only one start request');
  if (pendingCancelToken && pendingCancelToken !== payload.runToken) {
    throw new Error('sandbox utility pending cancellation token does not match start');
  }
  acceptedRunToken = payload.runToken;
  run = runSandboxUtilityProcess({
    request: payload,
    platform: platformRuntime.platform,
    launchOwnedProcess,
    publish(childPayload) {
      if (!transport) {
        return Promise.reject(new Error('sandbox utility transport is unavailable'));
      }
      return transport.send(parseSandboxUtilityChildPayload(childPayload));
    },
  });
  if (pendingCancelToken) run.terminate('cancelled');
  void run.start().then(
    () => scheduleExit(utilityFailed ? 1 : 0),
    () => scheduleExit(1),
  );
}

// Electron 37+ 只警告未处理 rejection；显式归一为 transport failure，不能误报成功。
process.on('unhandledRejection', failTransport);

transport = createAcknowledgedSandboxUtilityTransport({
  generation,
  postMessage: postParentMessage,
  parseIncomingPayload: parseSandboxUtilityHostPayload,
  acceptIncomingPayload(payload) {
    if (payload.kind === 'sandbox_start') {
      acceptStart(payload);
      return undefined;
    }
    if (payload.kind === 'sandbox_owner_end') {
      ownerEnded = true;
      if (run) run.terminate('owner_ended');
      else scheduleExit(0);
      return undefined;
    }
    if (ownerEnded) throw new Error('sandbox utility owner has ended');
    if (acceptedRunToken && payload.runToken !== acceptedRunToken) {
      throw new Error('sandbox utility cancellation token does not match active run');
    }
    if (!acceptedRunToken) {
      if (pendingCancelToken && pendingCancelToken !== payload.runToken) {
        throw new Error('sandbox utility accepts cancellation for only one run');
      }
      pendingCancelToken = payload.runToken;
      return undefined;
    }
    run?.terminate('cancelled');
    return undefined;
  },
  onFailure: failTransport,
});

subscribeToParentMessages(message => transport?.receive(message));

void transport.send({ kind: 'sandbox_utility_ready', utilityPid: process.pid }).catch(() => {
  failTransport();
});
