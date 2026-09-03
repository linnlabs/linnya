import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CommandLaunchSnapshotV1Schema,
  parseCommandExecutionTerminal,
  type CommandExecutionTerminalV1,
} from '@app/schemas/commands';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
  type PreparedCommandExecutionRuntime,
} from '../../../../../domains/commands';
import {
  activateDesiredBackendPluginClis,
  clearBackendPluginClisForTests,
} from '../../../plugin-registry/pluginCliInvocationRuntime';
import type { BackendPluginCliRegistration } from '../../../plugin-registry/registry';
import {
  LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV,
  LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV,
  PLUGIN_CLI_MAX_OUTPUT_BYTES,
  PLUGIN_CLI_OUTPUT_FRAME_BYTES,
  parsePluginCliBridgeFrame,
  startPluginCliShellBridgeRuntime,
  type PluginCliBridgeDiagnosticPort,
  type PluginCliBridgeFrameV1,
  type PluginCliShellBridgeRuntime,
} from '..';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const bridges: PluginCliShellBridgeRuntime[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.closeAndWait()));
  await Promise.all(temporaryRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
  await clearBackendPluginClisForTests();
});

function runNativeFacade(input: {
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly internalEnvironment: Readonly<Record<string, string>>;
}): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executablePath, input.argv, {
      shell: false,
      env: { ...process.env, ...input.internalEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', exitCode => resolve({
      exitCode,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function createLaunch(input: {
  readonly permissionLevel?: 'read_only' | 'standard';
  readonly internalDataAccess?: 'allowed' | 'denied';
} = {}) {
  const permissionLevel = input.permissionLevel ?? 'standard';
  const internalDataAccess = input.internalDataAccess ?? 'allowed';
  const identity = {
    conversation_id: 'conversation-plugin-cli-bridge',
    agent_run_id: 'agent-run-plugin-cli-bridge',
    origin_tool_call_id: 'tool-call-plugin-cli-bridge',
    command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000001',
    owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000002',
    created_at_ms: 100,
  };
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: permissionLevel,
    effective_level: permissionLevel,
    grant_source: 'global_setting',
    internal_data_access: internalDataAccess,
  };
  return CommandLaunchSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'pipe_command_launch_snapshot',
    mode: 'pipe',
    stdin: 'closed',
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: 'linnya-slides inspect --presentation deck-1',
      cwd: '/tmp/conversation-plugin-cli-bridge',
      permission,
    },
    conversation_root: '/tmp/conversation-plugin-cli-bridge',
    permission,
    shell: {
      platform: 'macos',
      shell_semantics_id: 'zsh',
      shell_version: '5.9',
      snapshot_revision: 'plugin-cli-bridge-test',
      output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'plain-v1',
      executable_path: '/bin/zsh',
      argv_prefix: ['-f', '-c'],
    },
    environment: {
      revision: 'plugin-cli-bridge-test',
      entries: { PATH: '/usr/bin:/bin' },
    },
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: 30_000,
  });
}

function createTerminal(launch: ReturnType<typeof createLaunch>): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: launch.proposal.identity,
    settled_at_ms: 200,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: { status: 'observed', exit_code: 0, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  });
}

function createPreparedRuntime(launch: ReturnType<typeof createLaunch>): {
  readonly runtime: PreparedCommandExecutionRuntime;
  readonly terminal: Deferred<CommandExecutionTerminalV1>;
} {
  const terminal = deferred<CommandExecutionTerminalV1>();
  return {
    terminal,
    runtime: {
      interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
      terminal: terminal.promise,
      outputObservation: {
        read: () => ({ status: 'invalid_cursor' }),
        waitForChange: async () => ({ status: 'invalid_cursor' }),
      },
      settledTextOutput: Promise.resolve(createUnavailableCommandSettledTextOutput('pipe')),
      start: async () => ({ status: 'running', startedAtMs: 150 }),
      stopAndWait: async () => {
        const value = createTerminal(launch);
        terminal.resolve(value);
        return value;
      },
    },
  };
}

function registerCli(cli: BackendPluginCliContribution): BackendPluginCliRegistration {
  const registration = { pluginId: 'slides', cli };
  activateDesiredBackendPluginClis([registration]);
  return registration;
}

async function startBridge(input: {
  readonly registration: BackendPluginCliRegistration;
  readonly internalDataContext?: unknown;
  readonly diagnostics?: PluginCliBridgeDiagnosticPort;
  readonly createCorrelationId?: () => string;
}): Promise<PluginCliShellBridgeRuntime> {
  const bridge = await startPluginCliShellBridgeRuntime({
    resolveCli: pluginId => (
      pluginId === input.registration.pluginId ? input.registration : undefined
    ),
    internalDataContext: input.internalDataContext ?? Object.freeze({}),
    diagnostics: input.diagnostics ?? { recordUnexpectedFailure: () => undefined },
    createToken: () => 'a'.repeat(64),
    createInvocationId: () => 'invocation-1',
    ...(input.createCorrelationId ? { createCorrelationId: input.createCorrelationId } : {}),
  });
  bridges.push(bridge);
  return bridge;
}

async function invoke(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly argv: readonly string[];
}): Promise<{ readonly status: number; readonly frames: PluginCliBridgeFrameV1[] }> {
  const response = await fetch(input.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-linnya-plugin-cli-token': input.token,
    },
    body: JSON.stringify({
      protocol_version: 1,
      kind: 'plugin_cli_invoke',
      plugin_id: 'slides',
      argv: input.argv,
    }),
  });
  const body = await response.text();
  return {
    status: response.status,
    frames: body.trim()
      ? body.trim().split('\n').map(line => parsePluginCliBridgeFrame(JSON.parse(line)))
      : [],
  };
}

describe('Plugin CLI Shell bridge', () => {
  it('只在父 Shell start 后接纳 token，并把插件结果投影成真实 CLI frame', async () => {
    const execute = vi.fn(async () => ({ exitCode: 3, stdout: 'result\n', stderr: 'warning\n' }));
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'required',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute,
        },
      }),
    });
    const internalDataContext = { databaseService: { kind: 'workspace-db' } };
    const bridge = await startBridge({ registration, internalDataContext });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    await expect(invoke({ endpoint, token, argv: ['inspect'] }))
      .resolves.toEqual({ status: 401, frames: [] });

    const runtime = scope.decorate(prepared.runtime);
    await expect(runtime.start()).resolves.toMatchObject({ status: 'running' });
    await expect(invoke({ endpoint, token, argv: ['inspect', '--presentation', 'deck-1'] }))
      .resolves.toEqual({
        status: 200,
        frames: [
          expect.objectContaining({ kind: 'plugin_cli_output', channel: 'stdout' }),
          expect.objectContaining({ kind: 'plugin_cli_output', channel: 'stderr' }),
          expect.objectContaining({ kind: 'plugin_cli_terminal', exit_code: 3 }),
        ],
      });
    expect(execute).toHaveBeenCalledWith({
      hostContext: internalDataContext,
      signal: expect.any(AbortSignal),
    });

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
    await expect(invoke({ endpoint, token, argv: ['inspect'] }))
      .resolves.toEqual({ status: 401, frames: [] });
  });

  it('把超过旧字符上限的合法结果按 raw bytes 分帧且无损返回', async () => {
    const stdout = `${'诊断结果'.repeat(30_000)}\n`;
    const registration = registerCli({
      prepare: () => ({
        status: 'completed',
        result: { exitCode: 0, stdout, stderr: '' },
      }),
    });
    const bridge = await startBridge({ registration });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const result = await invoke({ endpoint, token, argv: ['diagnose'] });
    const outputFrames = result.frames.filter(frame => frame.kind === 'plugin_cli_output');
    const output = Buffer.concat(outputFrames.map(frame => Buffer.from(frame.bytes_base64, 'base64')));

    expect(outputFrames.length).toBeGreaterThan(1);
    expect(outputFrames.every(frame => (
      Buffer.from(frame.bytes_base64, 'base64').byteLength <= PLUGIN_CLI_OUTPUT_FRAME_BYTES
    ))).toBe(true);
    expect(output.toString('utf8')).toBe(stdout);
    expect(result.frames[result.frames.length - 1]).toMatchObject({
      kind: 'plugin_cli_terminal',
      exit_code: 0,
    });

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('总输出超过 bridge byte 预算时返回明确拒绝且不记为未知异常', async () => {
    const recordUnexpectedFailure = vi.fn();
    const registration = registerCli({
      prepare: () => ({
        status: 'completed',
        result: {
          exitCode: 0,
          stdout: 'x'.repeat(PLUGIN_CLI_MAX_OUTPUT_BYTES),
          stderr: 'x',
        },
      }),
    });
    const bridge = await startBridge({
      registration,
      diagnostics: { recordUnexpectedFailure },
    });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    await expect(invoke({ endpoint, token, argv: ['diagnose'] })).resolves.toEqual({
      status: 200,
      frames: [expect.objectContaining({
        kind: 'plugin_cli_failure',
        code: 'output_limit_exceeded',
        exit_code: 74,
      })],
    });
    expect(recordUnexpectedFailure).not.toHaveBeenCalled();

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('在插件接触 DB/worker 前拒绝超出父 Shell 权限的 access plan', async () => {
    const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'required',
            conversationFiles: 'write',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute,
        },
      }),
    });
    const bridge = await startBridge({ registration });
    const launch = createLaunch({ permissionLevel: 'read_only', internalDataAccess: 'denied' });
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const result = await invoke({ endpoint, token, argv: ['render'] });
    expect(result).toEqual({
      status: 200,
      frames: [expect.objectContaining({
        kind: 'plugin_cli_failure',
        code: 'permission_denied',
        exit_code: 77,
      })],
    });
    expect(execute).not.toHaveBeenCalled();

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('未知插件异常只向 CLI 返回关联号，并把真实阶段和原因交给内部诊断', async () => {
    const cause = new Error('database worker is offline');
    const recordUnexpectedFailure = vi.fn();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute: async () => { throw cause; },
        },
      }),
    });
    const bridge = await startBridge({
      registration,
      diagnostics: { recordUnexpectedFailure },
      createCorrelationId: () => 'bridge-correlation-1',
    });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const result = await invoke({ endpoint, token, argv: ['inspect'] });

    expect(result).toEqual({
      status: 200,
      frames: [expect.objectContaining({
        kind: 'plugin_cli_failure',
        code: 'runtime_failure',
        exit_code: 70,
        message: 'Plugin CLI bridge failed unexpectedly. Reference: bridge-correlation-1.',
      })],
    });
    expect(JSON.stringify(result.frames)).not.toContain(cause.message);
    expect(recordUnexpectedFailure).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'bridge-correlation-1',
      stage: 'execute',
      identity: launch.proposal.identity,
      pluginId: 'slides',
      invocationId: `${launch.proposal.identity.command_execution_id}_cli_invocation-1`,
      error: cause,
    }));

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('父 Shell terminal 会撤销 token、abort invocation，并等待插件 lease 真正释放', async () => {
    const executeStarted = deferred<void>();
    const releaseCleanup = deferred<void>();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          async execute({ signal }) {
            executeStarted.resolve();
            await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {
              once: true,
            }));
            await releaseCleanup.promise;
            return { exitCode: 0, stdout: '', stderr: '' };
          },
        },
      }),
    });
    const bridge = await startBridge({ registration });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const invocation = invoke({ endpoint, token, argv: ['inspect'] });
    await executeStarted.promise;
    prepared.terminal.resolve(createTerminal(launch));
    let terminalSettled = false;
    void runtime.terminal.then(() => { terminalSettled = true; });
    await Promise.resolve();
    expect(terminalSettled).toBe(false);

    releaseCleanup.resolve();
    await expect(invocation).resolves.toEqual({
      status: 200,
      frames: [expect.objectContaining({ kind: 'plugin_cli_failure', code: 'cancelled' })],
    });
    await runtime.terminal;
    expect(terminalSettled).toBe(true);
  });

  it.runIf(Boolean(process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH))(
    '真实 native thin client 保留 argv/stdout/stderr/exit code，并且不启动 Electron',
    async () => {
      const nativeClientPath = process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH;
      if (!nativeClientPath) throw new Error('native client path is required');
      const nativeStdout = `${'native large output\n'.repeat(8_000)}`;
      const observedArgv: string[][] = [];
      const registration = registerCli({
        prepare({ argv }) {
          observedArgv.push([...argv]);
          return {
            status: 'completed',
            result: { exitCode: 23, stdout: nativeStdout, stderr: 'native stderr\n' },
          };
        },
      });
      const bridge = await startBridge({ registration });
      const launch = createLaunch();
      const prepared = createPreparedRuntime(launch);
      const scope = bridge.prepareExecution(launch);
      const runtime = scope.decorate(prepared.runtime);
      await runtime.start();

      const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-cli-native-e2e-'));
      temporaryRoots.push(root);
      const facadePath = path.join(root, process.platform === 'win32'
        ? 'linnya-slides.exe'
        : 'linnya-slides');
      await fsp.copyFile(path.resolve(nativeClientPath), facadePath);
      if (process.platform !== 'win32') await fsp.chmod(facadePath, 0o700);

      const result = await runNativeFacade({
        executablePath: facadePath,
        argv: [
          'inspect',
          '--presentation',
          'deck with spaces',
          '',
          '"quoted"',
          'line one\nline two',
          '中文参数',
        ],
        internalEnvironment: scope.internalEnvironment,
      });
      expect(result).toEqual({
        exitCode: 23,
        stdout: nativeStdout,
        stderr: 'native stderr\n',
      });
      expect(observedArgv).toEqual([
        [
          'inspect',
          '--presentation',
          'deck with spaces',
          '',
          '"quoted"',
          'line one\nline two',
          '中文参数',
        ],
      ]);

      prepared.terminal.resolve(createTerminal(launch));
      await runtime.terminal;
    },
  );
});
