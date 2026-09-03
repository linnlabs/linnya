import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import {
  parseCommandRunnerEvent,
  parseCommandRunnerRequest,
  type CommandExecutionTerminalV1,
  type CommandExecutionIdentity,
  type CommandRunnerEventV1,
} from '@app/schemas/commands';
import type { CommandRunnerProcessControl } from '../../../../../src/domains/commands';
import { createElectronCommandRunnerProcessPort } from '../../../../../src/electron-main/commands/runner-runtime';

declare const LINNYA_EXPECTED_WINDOWS_NATIVE_RUNTIME_VERSION: string;

const RESULT_PATH = process.env.LINNYA_FORMAL_RUNNER_RESULT_PATH;
const RUN_CWD = process.env.LINNYA_FORMAL_RUNNER_CWD;
const RUN_MODE = process.env.LINNYA_FORMAL_RUNNER_MODE ?? 'settlement';
const CRASH_RUN_TOKEN = process.env.LINNYA_FORMAL_RUNNER_CRASH_TOKEN;
const EXPECTED_OUTPUT = 'formal-adapter-output';
const SCENARIO_DEADLINE_MS = 30_000;

if (!RESULT_PATH || !path.isAbsolute(RESULT_PATH)) {
  throw new Error('LINNYA_FORMAL_RUNNER_RESULT_PATH must be an absolute path');
}
if (!RUN_CWD || !path.isAbsolute(RUN_CWD)) {
  throw new Error('LINNYA_FORMAL_RUNNER_CWD must be an absolute path');
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(label: string): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timeout = setTimeout(() => {
    rejectPromise(new Error(`${label} timed out`));
  }, SCENARIO_DEADLINE_MS);
  return {
    promise,
    resolve(value) {
      clearTimeout(timeout);
      resolvePromise(value);
    },
    reject(error) {
      clearTimeout(timeout);
      rejectPromise(error);
    },
  };
}

function publishResult(value: unknown): void {
  const pendingPath = `${RESULT_PATH}.${process.pid}.pending`;
  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify(value));
  fs.renameSync(pendingPath, RESULT_PATH);
}

function appendStage(stage: string): void {
  fs.appendFileSync(`${RESULT_PATH}.stages.log`, `${Date.now()}\t${stage}\n`);
}

function createIdentity(): CommandExecutionIdentity {
  return {
    conversation_id: 'formal-command-runner-conversation',
    agent_run_id: 'formal-command-runner-agent-run',
    origin_tool_call_id: 'formal-command-runner-tool-call',
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`,
    created_at_ms: Date.now(),
  };
}

function stringEnvironment(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) entries[name] = value;
  }
  return entries;
}

function createStartRequest(command: string, mode: 'pipe' | 'pty' = 'pipe') {
  const identity = createIdentity();
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  } as const;
  const platform = process.platform === 'win32' ? 'windows' : 'macos';
  const revision = `formal-${platform}-environment-v1`;
  const shell = platform === 'windows'
    ? {
        platform,
        shell_semantics_id: 'powershell-5.1',
        shell_version: '5.1',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'powershell-utf8-v1',
        executable_path: path.join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        ),
        argv_prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
      } as const
    : {
        platform,
        shell_semantics_id: 'zsh',
        shell_version: '5.9',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: '/bin/zsh',
        argv_prefix: ['-f', '-c'],
      } as const;

  const launchBase = {
    protocol_version: 1 as const,
    conversation_root: RUN_CWD,
    proposal: {
      protocol_version: 1 as const,
      kind: 'shell_command_proposal' as const,
      identity,
      command,
      cwd: RUN_CWD,
      permission,
    },
    permission,
    shell,
    environment: {
      revision,
      entries: stringEnvironment(),
    },
    lifecycle_policy: 'terminate_with_run' as const,
    hard_timeout_ms: 30_000,
  };
  return parseCommandRunnerRequest({
    protocol_version: 1,
    kind: 'command_runner_start',
    launch: mode === 'pipe'
      ? {
          ...launchBase,
          kind: 'pipe_command_launch_snapshot',
          mode: 'pipe',
          stdin: 'closed',
        }
      : {
          ...launchBase,
          kind: 'pty_command_launch_snapshot',
          mode: 'pty',
          stdin: 'pty',
          terminal_size: { columns: 90, rows: 30 },
        },
  });
}

interface ObservedElectronProcess {
  readonly pid: number;
  readonly type: string;
  readonly creationTime: number;
  readonly serviceName?: string;
  readonly name?: string;
}

function captureElectronProcesses(): ObservedElectronProcess[] {
  return app.getAppMetrics().map(metric => ({
    pid: metric.pid,
    type: metric.type,
    creationTime: metric.creationTime,
    ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
    ...(metric.name ? { name: metric.name } : {}),
  }));
}

function createRunnerPort(runnerPath: string) {
  return createElectronCommandRunnerProcessPort({
    runnerPath,
    helperEnvironment: process.platform === 'darwin'
      ? { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
      : {},
    platformRuntime: process.platform === 'darwin'
      ? { schema_version: 1, platform: 'darwin' }
      : {
          schema_version: 1,
          platform: 'win32',
          manifest_path: path.join(
            process.resourcesPath,
            'command-runtime/windows/x64/linnyaCommandProcessOwner.manifest.json',
          ),
          expected_runtime_version: LINNYA_EXPECTED_WINDOWS_NATIVE_RUNTIME_VERSION,
          expected_application_version: app.getVersion(),
          trust: { kind: 'development' },
        },
  });
}

async function runScenario(input: {
  readonly name: string;
  readonly command: string;
  readonly mode: 'pipe' | 'pty';
  readonly endOwnerAfterStarted: boolean;
  readonly submitAfterStarted?: string;
  readonly runnerPath: string;
}): Promise<{
  readonly name: string;
  readonly output: string;
  readonly terminationCause: string;
  readonly processExit: CommandExecutionTerminalV1['process_exit'];
  readonly outputDrain: CommandExecutionTerminalV1['output_drain'];
  readonly treeCleanup: CommandExecutionTerminalV1['tree_cleanup'];
  readonly resourceRelease: CommandExecutionTerminalV1['resource_release'];
  readonly disconnectCount: number;
  readonly closeCount: number;
  readonly interactionAccepted: boolean;
  readonly electronProcesses: ObservedElectronProcess[];
}> {
  const started = deferred<void>(`${input.name} started`);
  const terminal = deferred<Extract<CommandRunnerEventV1, {
    readonly kind: 'command_runner_terminal';
  }>>(`${input.name} terminal`);
  const closed = deferred<void>(`${input.name} close`);
  const interaction = input.submitAfterStarted === undefined
    ? undefined
    : deferred<void>(`${input.name} interaction`);
  const outputChunks: Uint8Array[] = [];
  let control: CommandRunnerProcessControl | undefined;
  let disconnectCount = 0;
  let closeCount = 0;
  let startedSeen = false;
  let terminalSeen = false;
  let electronProcesses: ObservedElectronProcess[] = [];
  // 启动请求必须先完整冻结；fork 后再校验会在校验失败时留下无人接管的 utility。
  const startRequest = createStartRequest(input.command, input.mode);
  const port = createRunnerPort(input.runnerPath);

  control = port.fork({
    onMessage(rawEvent) {
      const event = parseCommandRunnerEvent(rawEvent);
      if (event.kind === 'command_runner_started') {
        startedSeen = true;
        electronProcesses = captureElectronProcesses();
        started.resolve();
        if (input.endOwnerAfterStarted) control?.disconnect();
        return;
      }
      if (event.kind === 'command_runner_output') {
        if (event.channel === 'stdout') outputChunks.push(event.bytes);
        return;
      }
      if (event.kind === 'command_runner_pty_output') {
        outputChunks.push(event.bytes);
        return;
      }
      if (event.kind === 'command_runner_interaction_result') {
        if (event.result.status === 'accepted') interaction?.resolve();
        else interaction?.reject(new Error(
          `${input.name} interaction rejected: ${event.result.code}`,
        ));
        return;
      }
      terminalSeen = true;
      if (!startedSeen) {
        started.reject(new Error(
          `${input.name} ended before started: ${JSON.stringify(event.terminal)}`,
        ));
      }
      terminal.resolve(event);
    },
    onDiagnostic() {
      // utility stderr 是可选诊断，不参与场景通过或生命周期结算。
    },
    onDisconnect() {
      disconnectCount += 1;
    },
    onError(error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      started.reject(normalized);
      terminal.reject(normalized);
      closed.reject(normalized);
    },
    onClose() {
      closeCount += 1;
      if (!startedSeen) {
        started.reject(new Error(`${input.name} utility closed before started`));
      }
      if (!terminalSeen) {
        terminal.reject(new Error(`${input.name} utility closed before terminal`));
      }
      closed.resolve();
    },
  });

  await control.send(startRequest);
  await started.promise;
  if (input.submitAfterStarted !== undefined) {
    await control.send(parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_interaction',
      identity: startRequest.launch.proposal.identity,
      interaction_id: 0,
      action: { type: 'submit', input: input.submitAfterStarted },
    }));
    await interaction?.promise;
  }
  const terminalEvent = await terminal.promise;
  await closed.promise;

  return {
    name: input.name,
    output: Buffer.concat(outputChunks).toString('utf8'),
    terminationCause: terminalEvent.terminal.termination_cause,
    processExit: terminalEvent.terminal.process_exit,
    outputDrain: terminalEvent.terminal.output_drain,
    treeCleanup: terminalEvent.terminal.tree_cleanup,
    resourceRelease: terminalEvent.terminal.resource_release,
    disconnectCount,
    closeCount,
    interactionAccepted: interaction !== undefined,
    electronProcesses,
  };
}

function quotePosixLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createUtilityCrashCommand(runToken: string): {
  readonly command: string;
  readonly businessPidPath: string;
  readonly heartbeatPath: string;
} {
  const businessPidPath = path.join(RUN_CWD, 'utility-crash-business.pid');
  const heartbeatPath = path.join(RUN_CWD, 'utility-crash-business.heartbeat.log');
  if (process.platform === 'win32') {
    return {
      businessPidPath,
      heartbeatPath,
      command: [
        `Set-Content -LiteralPath ${quotePowerShellLiteral(businessPidPath)} -Value $PID -NoNewline`,
        '$sequence = 0',
        'while ($true) {',
        '  $sequence += 1',
        `  Add-Content -LiteralPath ${quotePowerShellLiteral(heartbeatPath)} `
          + `-Value (@('${runToken}', 'root', $PID, $sequence, `
          + '[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -join [char]9)',
        '  Start-Sleep -Milliseconds 50',
        '}',
      ].join('\n'),
    };
  }
  return {
    businessPidPath,
    heartbeatPath,
    command: [
      `printf '%s' "$$" > ${quotePosixLiteral(businessPidPath)}`,
      'sequence=0',
      'while true; do',
      '  sequence=$((sequence + 1))',
      `  printf '%s\\troot\\t%s\\t%s\\t%s\\n' ${quotePosixLiteral(runToken)} `
        + `"$$" "$sequence" "$(date +%s)" >> ${quotePosixLiteral(heartbeatPath)}`,
      '  sleep 0.05',
      'done',
    ].join('\n'),
  };
}

async function runUtilityCrashScenario(runnerPath: string, runToken: string): Promise<void> {
  const crash = createUtilityCrashCommand(runToken);
  const started = deferred<void>('utility crash command started');
  const closed = deferred<void>('utility crash process closed');
  let utilityPid: number | undefined;
  const control = createRunnerPort(runnerPath).fork({
    onMessage(rawEvent) {
      const event = parseCommandRunnerEvent(rawEvent);
      if (event.kind === 'command_runner_started') {
        const observedProcesses = captureElectronProcesses();
        const utilities = observedProcesses.filter(
          entry => entry.type === 'Utility'
            && entry.name === 'Linnya Command Runner',
        );
        if (utilities.length !== 1) {
          started.reject(new Error(
            `expected one command utility: ${JSON.stringify(observedProcesses)}`,
          ));
          return;
        }
        utilityPid = utilities[0]?.pid;
        started.resolve();
        return;
      }
      if (event.kind === 'command_runner_terminal') {
        closed.reject(new Error(`utility crash command ended before host kill: ${JSON.stringify(event)}`));
      }
    },
    onDiagnostic() {},
    onDisconnect() {},
    onError(error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      started.reject(normalized);
      closed.reject(normalized);
    },
    onClose() {
      closed.resolve();
    },
  });

  await control.send(createStartRequest(crash.command));
  await started.promise;
  if (!Number.isSafeInteger(utilityPid) || utilityPid === undefined || utilityPid <= 0) {
    throw new Error('command utility PID is unavailable after started');
  }
  publishResult({
    success: true,
    version: 1,
    phase: 'utility_crash_ready',
    platform: process.platform,
    architecture: process.arch,
    utilityPid,
    businessPidPath: crash.businessPidPath,
    heartbeatPath: crash.heartbeatPath,
    runToken,
  });
  await closed.promise;
  publishResult({
    success: true,
    version: 1,
    phase: 'utility_crash_closed',
    platform: process.platform,
    architecture: process.arch,
    utilityPid,
    businessPidPath: crash.businessPidPath,
    heartbeatPath: crash.heartbeatPath,
    runToken,
  });
}

async function main(): Promise<void> {
  appendStage('main_entered');
  await app.whenReady();
  appendStage('electron_ready');
  const runnerPath = path.join(
    __dirname,
    'commands/commandRunnerUtilityProcess.cjs',
  );
  if (RUN_MODE === 'utility-crash') {
    if (!CRASH_RUN_TOKEN) {
      throw new Error('LINNYA_FORMAL_RUNNER_CRASH_TOKEN is required in utility-crash mode');
    }
    appendStage('utility_crash_scenario_started');
    await runUtilityCrashScenario(runnerPath, CRASH_RUN_TOKEN);
    app.quit();
    return;
  }
  if (RUN_MODE !== 'settlement') {
    throw new Error(`unsupported formal runner mode: ${RUN_MODE}`);
  }
  const normalCommand = process.platform === 'win32'
    ? `[Console]::Out.Write('${EXPECTED_OUTPUT}')`
    : `printf '${EXPECTED_OUTPUT}'`;
  const longCommand = process.platform === 'win32'
    ? 'Start-Sleep -Seconds 30'
    : 'sleep 30';
  appendStage('settlement_normal_started');
  const normal = await runScenario({
    name: 'normal',
    command: normalCommand,
    mode: 'pipe',
    endOwnerAfterStarted: false,
    runnerPath,
  });
  appendStage('settlement_owner_end_started');
  const ownerEnd = await runScenario({
    name: 'owner-end',
    command: longCommand,
    mode: 'pipe',
    endOwnerAfterStarted: true,
    runnerPath,
  });
  const ptyInputCommand = process.platform === 'win32'
    ? "$answer = [Console]::In.ReadLine(); [Console]::Out.Write(('pty-input:' + $answer))"
    : "IFS= read -r answer; printf 'pty-input:%s' \"$answer\"";
  appendStage('settlement_pty_input_started');
  const ptyInput = await runScenario({
    name: 'pty-input',
    command: ptyInputCommand,
    mode: 'pty',
    endOwnerAfterStarted: false,
    submitAfterStarted: 'accepted-value',
    runnerPath,
  });
  appendStage('settlement_pty_owner_end_started');
  const ptyOwnerEnd = await runScenario({
    name: 'pty-owner-end',
    command: longCommand,
    mode: 'pty',
    endOwnerAfterStarted: true,
    runnerPath,
  });
  if (normal.output !== EXPECTED_OUTPUT || normal.terminationCause !== 'natural_exit') {
    throw new Error(`normal scenario mismatch: ${JSON.stringify(normal)}`);
  }
  if (ownerEnd.terminationCause !== 'owner_ended') {
    throw new Error(`owner-end scenario mismatch: ${JSON.stringify(ownerEnd)}`);
  }
  if (
    !ptyInput.output.includes('pty-input:accepted-value')
    || ptyInput.terminationCause !== 'natural_exit'
    || !ptyInput.interactionAccepted
  ) {
    throw new Error(`PTY input scenario mismatch: ${JSON.stringify(ptyInput)}`);
  }
  if (ptyOwnerEnd.terminationCause !== 'owner_ended') {
    throw new Error(`PTY owner-end scenario mismatch: ${JSON.stringify(ptyOwnerEnd)}`);
  }
  if (
    normal.processExit.status !== 'observed'
    || normal.processExit.exit_code !== 0
    || normal.processExit.signal !== null
    || ownerEnd.processExit.status !== 'observed'
    || ptyInput.processExit.status !== 'observed'
    || ptyInput.processExit.exit_code !== 0
    || ptyOwnerEnd.processExit.status !== 'observed'
  ) {
    throw new Error(`platform process-exit observation mismatch: ${JSON.stringify({ normal, ownerEnd })}`);
  }
  for (const scenario of [normal, ownerEnd, ptyInput, ptyOwnerEnd]) {
    if (
      scenario.outputDrain.status !== 'complete'
      || scenario.treeCleanup.status !== 'succeeded'
      || scenario.resourceRelease.status !== 'succeeded'
    ) {
      throw new Error(`platform owner settlement mismatch: ${JSON.stringify(scenario)}`);
    }
  }
  if (
    normal.disconnectCount !== 1
    || normal.closeCount !== 1
    || ownerEnd.disconnectCount !== 1
    || ownerEnd.closeCount !== 1
    || ptyInput.disconnectCount !== 1
    || ptyInput.closeCount !== 1
    || ptyOwnerEnd.disconnectCount !== 1
    || ptyOwnerEnd.closeCount !== 1
  ) {
    throw new Error(`utility close projection mismatch: ${JSON.stringify({
      normal,
      ownerEnd,
      ptyInput,
      ptyOwnerEnd,
    })}`);
  }

  publishResult({
    success: true,
    version: 1,
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
    normal,
    ownerEnd,
    ptyInput,
    ptyOwnerEnd,
  });
  appendStage('settlement_result_published');
  app.quit();
}

app.on('window-all-closed', () => undefined);
appendStage('module_loaded');
void main().catch((error: unknown) => {
  appendStage('main_failed');
  publishResult({
    success: false,
    version: 1,
    platform: process.platform,
    architecture: process.arch,
    error: error instanceof Error ? error.stack : String(error),
  });
  app.exit(1);
});
