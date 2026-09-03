import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { CommandLaunchSnapshotV1 } from '@app/schemas/commands';
import { CommandRunnerInternalEnvironmentV1Schema } from '@app/schemas/commands';
import type { BackendPluginCliRegistration } from '../../../plugin-registry/registry';
import { acquireBackendPluginCliInvocation } from '../../../plugin-registry/pluginCliInvocationRuntime';
import type { PreparedCommandExecutionRuntime } from '../../../../../domains/commands';
import type { CommandExecutionRuntimeStopCause } from '../../../../../domains/commands';
import {
  PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION,
  PLUGIN_CLI_OUTPUT_FRAME_BYTES,
  PluginCliOutputLimitExceededError,
  parsePluginCliBridgeInvocationRequest,
  parsePluginCliExecutionResult,
  type PluginCliBridgeFailureCode,
  type PluginCliBridgeFrameV1,
  type PluginCliBridgeInvocationRequestV1,
} from '../definitions/pluginCliBridgeProtocol';
import type {
  PluginCliBridgeDiagnosticPort,
  PluginCliShellBridgeRuntime,
  PluginCliBridgeUnexpectedFailureStage,
} from '../definitions/pluginCliShellBridgeRuntime';
import type {
  ShellCommandExecutionScope,
} from '../../../adapters/commands/shell-runtime';
import { parsePluginCliAccessPlan } from '../functions/parsePluginCliAccessPlan';

const BRIDGE_BIND_HOST = '127.0.0.1';
const BRIDGE_ROUTE = '/v1/plugin-cli/invoke';
const BRIDGE_TOKEN_HEADER = 'x-linnya-plugin-cli-token';
const MAX_REQUEST_BYTES = 300_000;

export const LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV =
  'LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT';
export const LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV =
  'LINNYA_INTERNAL_PLUGIN_CLI_TOKEN';

interface InvocationLease {
  readonly launch: CommandLaunchSnapshotV1;
  readonly signal: AbortSignal;
  release(): void;
}

interface ExecutionScopeState {
  readonly token: string;
  readonly launch: CommandLaunchSnapshotV1;
  readonly controller: AbortController;
  readonly activities: Set<Promise<void>>;
  status: 'prepared' | 'active' | 'closing' | 'closed';
  acquire(): InvocationLease | undefined;
  activate(): void;
  closeAndWait(): Promise<void>;
}

class PluginCliBridgeFailure extends Error {
  constructor(
    readonly code: PluginCliBridgeFailureCode,
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PluginCliBridgeFailure';
  }
}

interface CombinedSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

function combineAbortSignals(signals: readonly AbortSignal[]): CombinedSignal {
  const controller = new AbortController();
  const listeners: Array<{ readonly signal: AbortSignal; readonly listener: () => void }> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

function createRequestAbortSignal(request: IncomingMessage): {
  readonly signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error('Plugin CLI client disconnected.'));
  request.once('aborted', abort);
  request.socket.once('close', abort);
  return {
    signal: controller.signal,
    dispose() {
      request.removeListener('aborted', abort);
      request.socket.removeListener('close', abort);
    },
  };
}

function frameLine(frame: PluginCliBridgeFrameV1): string {
  return `${JSON.stringify(frame)}\n`;
}

function outputFrames(
  channel: 'stdout' | 'stderr',
  text: string,
): PluginCliBridgeFrameV1[] {
  const bytes = Buffer.from(text, 'utf8');
  const frames: PluginCliBridgeFrameV1[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += PLUGIN_CLI_OUTPUT_FRAME_BYTES) {
    frames.push({
      protocol_version: PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION,
      kind: 'plugin_cli_output',
      channel,
      bytes_base64: bytes.subarray(
        offset,
        Math.min(offset + PLUGIN_CLI_OUTPUT_FRAME_BYTES, bytes.byteLength),
      ).toString('base64'),
    });
  }
  return frames;
}

function writeFrames(response: ServerResponse, frames: readonly PluginCliBridgeFrameV1[]): void {
  if (response.destroyed) return;
  const lines = frames.map(frameLine);
  response.statusCode = 200;
  response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader(
    'content-length',
    lines.reduce((total, line) => total + Buffer.byteLength(line), 0),
  );
  for (const line of lines) response.write(line);
  response.end();
}

function failureFrame(error: unknown): PluginCliBridgeFrameV1 {
  const failure = error instanceof PluginCliBridgeFailure
    ? error
    : new PluginCliBridgeFailure(
        'runtime_failure',
        70,
        'Plugin CLI bridge failed unexpectedly.',
      );
  return {
    protocol_version: PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION,
    kind: 'plugin_cli_failure',
    code: failure.code,
    message: failure.message,
    exit_code: failure.exitCode,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let observedBytes = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    observedBytes += chunk.byteLength;
    if (observedBytes > MAX_REQUEST_BYTES) {
      throw new PluginCliBridgeFailure('runtime_failure', 70, 'Plugin CLI request is too large.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new PluginCliBridgeFailure('runtime_failure', 70, 'Plugin CLI request is invalid.');
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, BRIDGE_BIND_HOST, () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Plugin CLI bridge did not receive a TCP address.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

/**
 * 当前 App 内唯一的 Plugin CLI bridge。它只承接父 Shell 的子活动，不创建 command
 * reservation、审批、输出 writer 或终态；真实 stdout/stderr 仍由 thin client 写回 Shell。
 */
export async function startPluginCliShellBridgeRuntime(input: {
  readonly resolveCli: (
    pluginId: string,
  ) => BackendPluginCliRegistration | undefined;
  readonly internalDataContext: unknown;
  readonly diagnostics: PluginCliBridgeDiagnosticPort;
  readonly createToken?: () => string;
  readonly createInvocationId?: () => string;
  readonly createCorrelationId?: () => string;
}): Promise<PluginCliShellBridgeRuntime> {
  const createToken = input.createToken ?? (() => randomBytes(32).toString('hex'));
  const createInvocationId = input.createInvocationId ?? randomUUID;
  const createCorrelationId = input.createCorrelationId ?? randomUUID;
  const scopes = new Map<string, ExecutionScopeState>();
  let lifecycle: 'active' | 'closing' | 'closed' = 'active';

  function normalizeUnexpectedFailure(
    error: unknown,
    context: {
      readonly stage: PluginCliBridgeUnexpectedFailureStage;
      readonly lease: InvocationLease;
      readonly pluginId?: string;
      readonly invocationId?: string;
    },
  ): PluginCliBridgeFailure {
    if (error instanceof PluginCliBridgeFailure) return error;
    const correlationId = createCorrelationId();
    input.diagnostics.recordUnexpectedFailure({
      correlationId,
      stage: context.stage,
      identity: context.lease.launch.proposal.identity,
      ...(context.pluginId ? { pluginId: context.pluginId } : {}),
      ...(context.invocationId ? { invocationId: context.invocationId } : {}),
      error,
    });
    return new PluginCliBridgeFailure(
      'runtime_failure',
      70,
      `Plugin CLI bridge failed unexpectedly. Reference: ${correlationId}.`,
    );
  }

  async function executeInvocation(
    lease: InvocationLease,
    request: PluginCliBridgeInvocationRequestV1,
    clientSignal: AbortSignal,
  ) {
    const invocationId = `${lease.launch.proposal.identity.command_execution_id}_cli_${createInvocationId()}`;
    let stage: PluginCliBridgeUnexpectedFailureStage = 'resolve_plugin';
    let pluginLease: ReturnType<typeof acquireBackendPluginCliInvocation>;
    let signals: CombinedSignal | undefined;
    try {
      const registration = input.resolveCli(request.plugin_id);
      if (!registration) {
        throw new PluginCliBridgeFailure(
          'plugin_unavailable',
          69,
          'Plugin CLI is unavailable.',
        );
      }
      stage = 'acquire_plugin';
      pluginLease = acquireBackendPluginCliInvocation(registration);
      if (!pluginLease) {
        throw new PluginCliBridgeFailure(
          'plugin_unavailable',
          69,
          'Plugin CLI is not accepting work.',
        );
      }
      signals = combineAbortSignals([lease.signal, pluginLease.signal, clientSignal]);
      signals.signal.throwIfAborted();
      stage = 'prepare';
      const preparation = registration.cli.prepare({
        argv: request.argv,
        invocationId,
        conversationRoot: lease.launch.conversation_root,
      });
      if (preparation.status === 'completed') {
        stage = 'project_result';
        return parsePluginCliExecutionResult(preparation.result);
      }
      stage = 'validate_access';
      const access = parsePluginCliAccessPlan(preparation.plan.access);
      if (
        access.internalDataAccess === 'required'
        && lease.launch.permission.internal_data_access !== 'allowed'
      ) {
        throw new PluginCliBridgeFailure(
          'permission_denied',
          77,
          'Internal Linnya data access is disabled for this Shell execution.',
        );
      }
      if (
        access.conversationFiles === 'write'
        && lease.launch.permission.effective_level === 'read_only'
      ) {
        throw new PluginCliBridgeFailure(
          'permission_denied',
          77,
          'This plugin CLI command requires Shell write access.',
        );
      }
      signals.signal.throwIfAborted();
      stage = 'execute';
      const result = await preparation.plan.execute({
        hostContext: access.internalDataAccess === 'required'
          ? input.internalDataContext
          : Object.freeze({}),
        signal: signals.signal,
      });
      signals.signal.throwIfAborted();
      stage = 'project_result';
      return parsePluginCliExecutionResult(result);
    } catch (error: unknown) {
      if (signals?.signal.aborted) {
        throw new PluginCliBridgeFailure('cancelled', 130, 'Plugin CLI invocation was cancelled.');
      }
      if (error instanceof PluginCliOutputLimitExceededError) {
        throw new PluginCliBridgeFailure(
          'output_limit_exceeded',
          74,
          'Plugin CLI output exceeds the bridge byte limit.',
        );
      }
      throw normalizeUnexpectedFailure(error, {
        stage,
        lease,
        pluginId: request.plugin_id,
        invocationId,
      });
    } finally {
      signals?.dispose();
      pluginLease?.release();
    }
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== BRIDGE_ROUTE) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const rawToken = request.headers[BRIDGE_TOKEN_HEADER];
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    const scope = token ? scopes.get(token) : undefined;
    const lease = scope?.acquire();
    if (!lease) {
      response.statusCode = 401;
      response.setHeader('cache-control', 'no-store');
      response.end();
      return;
    }
    const clientAbort = createRequestAbortSignal(request);
    let stage: PluginCliBridgeUnexpectedFailureStage = 'read_request';
    let invocation: PluginCliBridgeInvocationRequestV1 | undefined;
    try {
      const body = await readJsonBody(request);
      stage = 'parse_request';
      invocation = parsePluginCliBridgeInvocationRequest(body);
      stage = 'execute';
      const result = await executeInvocation(lease, invocation, clientAbort.signal);
      const frames = [
        ...outputFrames('stdout', result.stdout),
        ...outputFrames('stderr', result.stderr),
        {
          protocol_version: PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION,
          kind: 'plugin_cli_terminal' as const,
          exit_code: result.exitCode,
        },
      ];
      stage = 'write_response';
      writeFrames(response, frames);
    } catch (error: unknown) {
      writeFrames(response, [failureFrame(normalizeUnexpectedFailure(error, {
        stage,
        lease,
        ...(invocation ? { pluginId: invocation.plugin_id } : {}),
      }))]);
    } finally {
      clientAbort.dispose();
      lease.release();
    }
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      if (!response.destroyed) response.end();
    });
  });
  server.keepAliveTimeout = 1_000;
  const port = await listen(server);
  const endpoint = `http://${BRIDGE_BIND_HOST}:${port}${BRIDGE_ROUTE}`;

  function createExecutionScope(launch: CommandLaunchSnapshotV1): ExecutionScopeState {
    const token = createToken();
    if (!token || scopes.has(token)) {
      throw new Error('Plugin CLI bridge token must be unique and non-empty.');
    }
    const controller = new AbortController();
    const activities = new Set<Promise<void>>();
    let closingPromise: Promise<void> | undefined;
    const scope: ExecutionScopeState = {
      token,
      launch,
      controller,
      activities,
      status: 'prepared',
      acquire() {
        if (scope.status !== 'active') return undefined;
        let releaseActivity: () => void = () => {};
        const settlement = new Promise<void>(resolve => {
          releaseActivity = resolve;
        });
        activities.add(settlement);
        let released = false;
        return {
          launch,
          signal: controller.signal,
          release() {
            if (released) return;
            released = true;
            activities.delete(settlement);
            releaseActivity();
          },
        };
      },
      activate() {
        if (scope.status !== 'prepared' || lifecycle !== 'active') {
          throw new Error('Plugin CLI bridge execution scope is not startable.');
        }
        scope.status = 'active';
        scopes.set(token, scope);
      },
      closeAndWait() {
        if (closingPromise) return closingPromise;
        if (scope.status === 'closed') return Promise.resolve();
        scope.status = 'closing';
        scopes.delete(token);
        controller.abort(new Error('Parent Shell execution ended.'));
        closingPromise = Promise.all([...activities]).then(() => {
          scope.status = 'closed';
        });
        return closingPromise;
      },
    };
    return scope;
  }

  function decorateRuntime(
    scope: ExecutionScopeState,
    runtime: PreparedCommandExecutionRuntime,
  ): PreparedCommandExecutionRuntime {
    const terminal = runtime.terminal.then(async value => {
      await scope.closeAndWait();
      return value;
    });
    return Object.freeze({
      interaction: runtime.interaction,
      terminal,
      outputObservation: runtime.outputObservation,
      settledTextOutput: runtime.settledTextOutput,
      async start() {
        scope.activate();
        try {
          const started = await runtime.start();
          if (started.status === 'terminal') {
            await scope.closeAndWait();
          }
          return started;
        } catch (error: unknown) {
          await scope.closeAndWait();
          throw error;
        }
      },
      async stopAndWait(cause: CommandExecutionRuntimeStopCause) {
        const scopeSettlement = scope.closeAndWait();
        const terminalSettlement = runtime.stopAndWait(cause);
        const [value] = await Promise.all([terminalSettlement, scopeSettlement]);
        return value;
      },
    });
  }

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    prepareExecution(launch: CommandLaunchSnapshotV1): ShellCommandExecutionScope {
      if (lifecycle !== 'active') {
        throw new Error('Plugin CLI bridge is not accepting Shell executions.');
      }
      const scope = createExecutionScope(launch);
      const internalEnvironment = CommandRunnerInternalEnvironmentV1Schema.parse({
        [LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV]: endpoint,
        [LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV]: scope.token,
      });
      return Object.freeze({
        internalEnvironment,
        decorate: (runtime: PreparedCommandExecutionRuntime) => decorateRuntime(scope, runtime),
      });
    },
    closeAndWait() {
      if (closePromise) return closePromise;
      lifecycle = 'closing';
      const serverSettlement = closeServer(server);
      const scopeSettlements = [...scopes.values()].map(scope => scope.closeAndWait());
      closePromise = Promise.all([serverSettlement, ...scopeSettlements]).then(() => {
        lifecycle = 'closed';
      });
      return closePromise;
    },
  });
}
