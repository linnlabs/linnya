import assert from 'node:assert/strict';
import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  MAX_COMMAND_OUTPUT_EVENT_BYTES,
  CommandExecutionIdentitySchema,
  parseCommandRunnerEvent,
  parseCommandRunnerRequest,
  type CommandExecutionIdentity,
  type CommandRunnerEventV1,
} from '@app/schemas/commands';
import {
  serializeLocalProcessPlatformRuntime,
} from '../../../src/infra/adapters/local-process-runtime/platform-runtime';
import { resolveCommandRunnerTestPlatformRuntime } from './functions/resolveCommandRunnerTestPlatformRuntime';

const repositoryRoot = process.env.LINNYA_COMMAND_TEST_CWD
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runnerPath = process.env.LINNYA_COMMAND_RUNNER_PATH
  ?? path.join(repositoryRoot, 'dist/main/commands/commandRunnerProcess.cjs');
const fixturePath = process.env.LINNYA_COMMAND_FIXTURE_PATH
  ?? path.join(
    repositoryRoot,
    'scripts/e2e/shell-tool/fixtures/commands/ordinary-pipe-fixture.cjs',
  );
const RUN_DEADLINE_MS = 15_000;
const localProcessPlatformRuntime = resolveCommandRunnerTestPlatformRuntime();
const platformRuntimeArgument = serializeLocalProcessPlatformRuntime(
  localProcessPlatformRuntime,
);

interface RunResult {
  readonly events: readonly CommandRunnerEventV1[];
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly runnerExitCode: number | null;
  readonly runnerSignal: NodeJS.Signals | null;
  readonly runnerDiagnostics: string;
}

function quoteShellArgument(value: string): string {
  if (process.platform === 'win32') return `'${value.replaceAll("'", "''")}'`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createIdentity(): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: `conversation-${randomUUID()}`,
    agent_run_id: `agent-run-${randomUUID()}`,
    origin_tool_call_id: `tool-call-${randomUUID()}`,
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`,
    created_at_ms: Date.now(),
  });
}

function createStartRequest(
  scenario: string,
  hardTimeoutMs: number,
): Extract<ReturnType<typeof parseCommandRunnerRequest>, { readonly kind: 'command_runner_start' }> {
  const identity = createIdentity();
  const basePermission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  } as const;
  const revision = `runner-e2e-${process.platform}-${process.version}`;
  const platform = process.platform === 'win32' ? 'windows' : 'macos';
  const shell = process.platform === 'win32'
    ? {
        platform,
        shell_semantics_id: 'powershell-5.1',
        shell_version: '5.1',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'powershell-utf8-v1',
        executable_path: `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
        argv_prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
      }
    : {
        platform,
        shell_semantics_id: 'zsh',
        shell_version: '5.9',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: '/bin/zsh',
        argv_prefix: ['-f', '-c'],
      };
  const command = scenario === 'hang'
    ? process.platform === 'win32'
      ? 'while ($true) { Start-Sleep -Milliseconds 100 }'
      : 'while true; do sleep 1; done'
    : scenario === 'pid-hang'
      ? process.platform === 'win32'
        ? 'Write-Output $PID; while ($true) { Start-Sleep -Milliseconds 100 }'
        : "printf '%s\\n' $$; while true; do sleep 1; done"
      : process.platform === 'win32'
        ? `& ${quoteShellArgument(process.execPath)} ${quoteShellArgument(fixturePath)} ${quoteShellArgument(scenario)}; exit $LASTEXITCODE`
        : `${quoteShellArgument(process.execPath)} ${quoteShellArgument(fixturePath)} ${quoteShellArgument(scenario)}`;

  const environmentEntries = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const request = parseCommandRunnerRequest({
    protocol_version: 1,
    kind: 'command_runner_start',
    launch: {
      protocol_version: 1,
      kind: 'pipe_command_launch_snapshot',
      conversation_root: repositoryRoot,
      proposal: {
        protocol_version: 1,
        kind: 'shell_command_proposal',
        identity,
        command,
        cwd: repositoryRoot,
        permission: basePermission,
      },
      permission: basePermission,
      mode: 'pipe',
      shell,
      environment: { revision, entries: environmentEntries },
      stdin: 'closed',
      lifecycle_policy: 'terminate_with_run',
      hard_timeout_ms: hardTimeoutMs,
    },
  });
  if (request.kind !== 'command_runner_start') {
    throw new Error('runner E2E start fixture produced a stop request');
  }
  return request;
}

function sendRequest(child: ChildProcess, request: ReturnType<typeof parseCommandRunnerRequest>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.send(request, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function concatenateOutput(
  events: readonly CommandRunnerEventV1[],
  channel: 'stdout' | 'stderr',
): Uint8Array {
  const outputEvents = events.filter((event): event is Extract<
    CommandRunnerEventV1,
    { readonly kind: 'command_runner_output' }
  > => event.kind === 'command_runner_output' && event.channel === channel);
  outputEvents.forEach((event, index) => {
    assert.equal(event.sequence, index, `${channel} sequence must be contiguous`);
    assert.ok(event.bytes.byteLength <= MAX_COMMAND_OUTPUT_EVENT_BYTES);
  });
  const totalBytes = outputEvents.reduce((total, event) => total + event.bytes.byteLength, 0);
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const event of outputEvents) {
    output.set(event.bytes, offset);
    offset += event.bytes.byteLength;
  }
  return output;
}

async function runScenario(input: {
  readonly scenario: string;
  readonly hardTimeoutMs?: number;
  readonly cancelAfterStarted?: boolean;
}): Promise<RunResult> {
  const request = createStartRequest(input.scenario, input.hardTimeoutMs ?? 5_000);
  const events: CommandRunnerEventV1[] = [];
  const forkOptions = {
    serialization: 'advanced',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  } satisfies ForkOptions & { readonly windowsHide: boolean };
  const runner = fork(runnerPath, [platformRuntimeArgument], forkOptions);
  let runnerDiagnostics = '';
  runner.stderr?.setEncoding('utf8');
  runner.stderr?.on('data', (chunk: string) => {
    runnerDiagnostics = `${runnerDiagnostics}${chunk}`.slice(-32_768);
  });

  return new Promise<RunResult>((resolve, reject) => {
    let settled = false;
    let terminalSeen = false;
    const deadline = setTimeout(() => {
      runner.kill();
      finish(reject, new Error(
        `runner scenario ${input.scenario} exceeded deadline; diagnostics=${runnerDiagnostics}`,
      ));
    }, RUN_DEADLINE_MS);

    function finish<T>(callback: (value: T) => void, value: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    }

    runner.on('message', (rawEvent: unknown) => {
      if (terminalSeen) {
        finish(reject, new Error(`runner sent an event after terminal in ${input.scenario}`));
        return;
      }
      let event: CommandRunnerEventV1;
      try {
        event = parseCommandRunnerEvent(rawEvent);
      } catch (error) {
        finish(reject, error instanceof Error ? error : new Error('runner sent an invalid event'));
        return;
      }
      assert.deepEqual(
        event.kind === 'command_runner_terminal' ? event.terminal.identity : event.identity,
        request.launch.proposal.identity,
      );
      events.push(event);
      if (event.kind === 'command_runner_started' && input.cancelAfterStarted) {
        setTimeout(() => {
          void sendRequest(runner, parseCommandRunnerRequest({
            protocol_version: 1,
            kind: 'command_runner_stop',
            identity: request.launch.proposal.identity,
            cause: 'user_cancelled',
          })).catch(error => finish(reject, error));
        }, 50);
      }
      if (event.kind === 'command_runner_terminal') terminalSeen = true;
    });
    runner.once('error', error => finish(reject, error));
    runner.once('exit', (runnerExitCode, runnerSignal) => {
      if (!terminalSeen) {
        finish(reject, new Error(
          `runner exited without terminal in ${input.scenario}: code=${runnerExitCode} `
            + `signal=${runnerSignal ?? 'none'} diagnostics=${runnerDiagnostics}`,
        ));
        return;
      }
      finish(resolve, {
        events,
        stdout: concatenateOutput(events, 'stdout'),
        stderr: concatenateOutput(events, 'stderr'),
        runnerExitCode,
        runnerSignal,
        runnerDiagnostics,
      });
    });
    void sendRequest(runner, request).catch(error => finish(reject, error));
  });
}

function terminalOf(result: RunResult): Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_terminal' }
> {
  const terminals = result.events.filter((event): event is Extract<
    CommandRunnerEventV1,
    { readonly kind: 'command_runner_terminal' }
  > => event.kind === 'command_runner_terminal');
  assert.equal(terminals.length, 1);
  assert.equal(result.events.at(-1)?.kind, 'command_runner_terminal');
  assert.equal(result.runnerExitCode, 0, result.runnerDiagnostics);
  assert.equal(result.runnerSignal, null);
  const terminal = terminals[0];
  assert.ok(terminal.output_sources);
  for (const channel of ['stdout', 'stderr'] as const) {
    const source = terminal.output_sources[channel];
    const outputEvents = result.events.filter(event => (
      event.kind === 'command_runner_output' && event.channel === channel
    ));
    const receivedBytes = channel === 'stdout' ? result.stdout.byteLength : result.stderr.byteLength;
    assert.equal(source.next_sequence, outputEvents.length);
    if (source.source_completion === 'complete') {
      assert.equal(source.observed_bytes, receivedBytes);
    } else {
      assert.ok(source.observed_bytes >= receivedBytes);
    }
  }
  return terminal;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(pid)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`business process ${pid} survived runner IPC disconnect`);
}

async function verifyDisconnectStopsBusinessProcess(): Promise<void> {
  const request = createStartRequest('pid-hang', 5_000);
  const forkOptions = {
    serialization: 'advanced',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  } satisfies ForkOptions & { readonly windowsHide: boolean };
  const runner = fork(runnerPath, [platformRuntimeArgument], forkOptions);
  let diagnostics = '';
  let pidText = '';
  let businessPid: number | undefined;
  runner.stderr?.setEncoding('utf8');
  runner.stderr?.on('data', (chunk: string) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-32_768);
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const deadline = setTimeout(() => {
      runner.kill();
      finish(reject, new Error(`IPC-disconnect scenario timed out; diagnostics=${diagnostics}`));
    }, RUN_DEADLINE_MS);

    function finish<T>(callback: (value: T) => void, value: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    }

    runner.on('message', (rawEvent: unknown) => {
      const event = parseCommandRunnerEvent(rawEvent);
      if (event.kind !== 'command_runner_output' || event.channel !== 'stdout') return;
      pidText += Buffer.from(event.bytes).toString('ascii');
      if (!pidText.includes('\n') || businessPid !== undefined) return;
      const parsedPid = Number.parseInt(pidText, 10);
      if (!Number.isSafeInteger(parsedPid) || parsedPid <= 0) {
        finish(reject, new Error(`fixture reported invalid PID: ${pidText}`));
        return;
      }
      businessPid = parsedPid;
      runner.disconnect();
    });
    runner.once('error', error => finish(reject, error));
    runner.once('exit', (exitCode, signal) => {
      if (businessPid === undefined) {
        finish(reject, new Error(`runner exited before reporting business PID: ${diagnostics}`));
        return;
      }
      if (exitCode !== 1 || signal !== null) {
        finish(reject, new Error(
          `runner transport loss exit mismatch: code=${exitCode} signal=${signal ?? 'none'}`,
        ));
        return;
      }
      finish(resolve, undefined);
    });
    void sendRequest(runner, request).catch(error => finish(reject, error));
  });

  if (businessPid === undefined) throw new Error('business PID was not captured');
  await waitForProcessExit(businessPid);
}

async function verifyStopBeforeStartIsRejected(): Promise<void> {
  const forkOptions = {
    serialization: 'advanced',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  } satisfies ForkOptions & { readonly windowsHide: boolean };
  const runner = fork(runnerPath, [platformRuntimeArgument], forkOptions);
  let diagnostics = '';
  runner.stderr?.setEncoding('utf8');
  runner.stderr?.on('data', (chunk: string) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-32_768);
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const deadline = setTimeout(() => {
      runner.kill();
      finish(reject, new Error(`stop-before-start scenario timed out; diagnostics=${diagnostics}`));
    }, RUN_DEADLINE_MS);

    function finish<T>(callback: (value: T) => void, value: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    }

    runner.once('error', error => finish(reject, error));
    runner.once('exit', (exitCode, signal) => {
      if (exitCode !== 1 || signal !== null) {
        finish(reject, new Error(
          `stop-before-start exit mismatch: code=${exitCode} signal=${signal ?? 'none'}`,
        ));
        return;
      }
      if (!diagnostics.includes('received a stop request before start')) {
        finish(reject, new Error(`stop-before-start diagnostic missing: ${diagnostics}`));
        return;
      }
      if (diagnostics.length > 4_128) {
        finish(reject, new Error(`stop-before-start diagnostic exceeded its bound`));
        return;
      }
      finish(resolve, undefined);
    });
    void sendRequest(runner, parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_stop',
      identity: createIdentity(),
      cause: 'user_cancelled',
    })).catch(error => finish(reject, error));
  });
}

async function main(): Promise<void> {
  const empty = await runScenario({ scenario: 'exit-zero' });
  assert.equal(empty.stdout.byteLength, 0);
  assert.equal(empty.stderr.byteLength, 0);
  const emptyTerminal = terminalOf(empty).terminal;
  if (emptyTerminal.outcome !== 'execution_ended') {
    throw new Error('empty command ended as a runtime failure');
  }
  assert.equal(emptyTerminal.termination_cause, 'natural_exit');

  const binary = await runScenario({ scenario: 'binary-nonzero' });
  assert.deepEqual([...binary.stdout], [0x00, 0xe4, 0xb8, 0xad, 0xff, 0x0a]);
  assert.deepEqual([...binary.stderr], [0x65, 0x72, 0x72, 0x00, 0x80, 0x0a]);
  assert.deepEqual(terminalOf(binary).terminal.process_exit, {
    status: 'observed',
    exit_code: 7,
    signal: null,
  });

  const boundary = await runScenario({ scenario: 'chunk-boundary' });
  assert.equal(boundary.stdout.byteLength, MAX_COMMAND_OUTPUT_EVENT_BYTES + 1);
  assert.equal(boundary.stdout.at(-1), 0x62);
  terminalOf(boundary);

  const fastTail = await runScenario({ scenario: 'fast-tail' });
  assert.equal(Buffer.from(fastTail.stdout).toString('utf8'), 'fast-tail-中文\n');
  terminalOf(fastTail);

  const descendantOutput = await runScenario({ scenario: 'descendant-output' });
  assert.equal(
    Buffer.from(descendantOutput.stdout).toString('utf8'),
    'descendant-tail-1\ndescendant-tail-2\ndescendant-tail-3\n'
      + 'descendant-tail-4\ndescendant-tail-5\n',
  );
  assert.equal(terminalOf(descendantOutput).terminal.output_drain.status, 'complete');

  const quietDescendant = await runScenario({ scenario: 'quiet-descendant' });
  const quietTerminal = terminalOf(quietDescendant);
  assert.deepEqual(quietTerminal.terminal.output_drain, { status: 'complete' });
  assert.deepEqual(quietTerminal.terminal.tree_cleanup, { status: 'succeeded' });
  assert.deepEqual(quietTerminal.terminal.resource_release, { status: 'succeeded' });
  assert.equal(quietTerminal.output_sources?.stdout.source_completion, 'complete');
  assert.equal(quietTerminal.output_sources?.stderr.source_completion, 'complete');

  const hardTimeout = await runScenario({ scenario: 'hang', hardTimeoutMs: 120 });
  const hardTimeoutTerminal = terminalOf(hardTimeout).terminal;
  if (hardTimeoutTerminal.outcome !== 'execution_ended') {
    throw new Error('hard timeout ended as a runtime failure');
  }
  assert.equal(hardTimeoutTerminal.termination_cause, 'hard_timeout');
  assert.deepEqual(hardTimeoutTerminal.tree_cleanup, { status: 'succeeded' });
  assert.deepEqual(hardTimeoutTerminal.resource_release, { status: 'succeeded' });

  const cancelled = await runScenario({ scenario: 'hang', cancelAfterStarted: true });
  const cancelledTerminal = terminalOf(cancelled).terminal;
  if (cancelledTerminal.outcome !== 'execution_ended') {
    throw new Error('cancelled command ended as a runtime failure');
  }
  assert.equal(cancelledTerminal.termination_cause, 'user_cancelled');
  assert.deepEqual(cancelledTerminal.tree_cleanup, { status: 'succeeded' });
  assert.deepEqual(cancelledTerminal.resource_release, { status: 'succeeded' });

  await verifyDisconnectStopsBusinessProcess();
  await verifyStopBeforeStartIsRejected();

  process.stdout.write(`${JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    scenarios: 10,
    status: 'passed',
  })}\n`);
}

await main();
