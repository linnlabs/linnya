import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = process.env.LINNYA_COMMAND_TEST_CWD
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runnerPath = process.env.LINNYA_COMMAND_RUNNER_PATH
  ?? path.join(repositoryRoot, 'dist/main/commands/commandRunnerProcess.cjs');
const fixturePath = process.env.LINNYA_COMMAND_WORKLOAD_FIXTURE_PATH
  ?? path.join(
    repositoryRoot,
    'scripts/e2e/shell-tool/fixtures/workload/command-capacity-workload.cjs',
  );
const outputPath = process.env.LINNYA_COMMAND_WORKLOAD_OUTPUT_PATH
  ?? path.join(repositoryRoot, `command-workload-${process.platform}-${Date.now()}.json`);
const manifestPath = process.env.LINNYA_WINDOWS_COMMAND_RUNTIME_MANIFEST_PATH;
const candidateConcurrency = Object.freeze([4, 8, 16]);
const timeoutProbeMilliseconds = Object.freeze([200, 500, 800, 5_000]);
const rounds = Number(process.env.LINNYA_COMMAND_WORKLOAD_ROUNDS ?? '3');
const COMMAND_HOLD_MILLISECONDS = 3_000;
const OUTPUT_BYTES_PER_RUN = 256 * 1024;
const FILE_BYTES_PER_RUN = 16 * 1024 * 1024;
const GROUP_DEADLINE_MILLISECONDS = 60_000;

if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10) {
  throw new Error('LINNYA_COMMAND_WORKLOAD_ROUNDS must be an integer from 1 to 10');
}
if (process.platform !== 'darwin' && process.platform !== 'win32') {
  throw new Error(`unsupported workload platform: ${process.platform}`);
}
if (process.platform === 'win32' && (!manifestPath || !path.win32.isAbsolute(manifestPath))) {
  throw new Error('Windows workload requires an absolute runtime manifest path');
}

function quoteShellArgument(value) {
  if (process.platform === 'win32') return `'${value.replaceAll("'", "''")}'`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cleanEnvironmentEntries() {
  const entries = {};
  const windowsKeys = new Set();
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (process.platform === 'win32') {
      const normalized = key.toLowerCase();
      if (windowsKeys.has(normalized)) continue;
      windowsKeys.add(normalized);
    }
    entries[key] = value;
  }
  return entries;
}

function platformRuntime() {
  if (process.platform === 'darwin') return { schema_version: 1, platform: 'darwin' };
  const manifest = JSON.parse(requireManifestText());
  return {
    schema_version: 1,
    platform: 'win32',
    manifest_path: manifestPath,
    expected_runtime_version: manifest.runtime_version,
    expected_application_version: manifest.application_version,
    trust: { kind: 'development' },
  };
}

function requireManifestText() {
  // Windows 远端只有 Node 标准库，保持 harness 自包含，避免复制整个 workspace。
  return readFileSync(manifestPath, 'utf8');
}

function createIdentity() {
  const suffix = randomUUID();
  return {
    conversation_id: `workload-conversation-${suffix}`,
    agent_run_id: `workload-agent-${suffix}`,
    origin_tool_call_id: `workload-tool-${suffix}`,
    command_execution_id: `command_execution_${suffix}`,
    owner_generation_id: `command_owner_${suffix}`,
    created_at_ms: Date.now(),
  };
}

function createStartRequest({ scenario, arguments: scenarioArguments, hardTimeoutMs, runRoot }) {
  const identity = createIdentity();
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  };
  const revision = `capacity-timeout-${process.platform}-${process.version}`;
  const shell = process.platform === 'win32'
    ? {
        platform: 'windows',
        shell_semantics_id: 'powershell-5.1',
        shell_version: '5.1',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'powershell-utf8-v1',
        executable_path: `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
        argv_prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
      }
    : {
        platform: 'macos',
        shell_semantics_id: 'zsh',
        shell_version: '5.9',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: '/bin/zsh',
        argv_prefix: ['-f', '-c'],
      };
  const commandArguments = [fixturePath, scenario, ...scenarioArguments]
    .map(quoteShellArgument)
    .join(' ');
  const command = process.platform === 'win32'
    ? `Write-Output "__LINNYA_SHELL_PID__:$PID"; & ${quoteShellArgument(process.execPath)} ${commandArguments}; exit $LASTEXITCODE`
    : `printf '__LINNYA_SHELL_PID__:%s\\n' $$; ${quoteShellArgument(process.execPath)} ${commandArguments}`;
  return {
    protocol_version: 1,
    kind: 'command_runner_start',
    launch: {
      protocol_version: 1,
      kind: 'pipe_command_launch_snapshot',
      mode: 'pipe',
      stdin: 'closed',
      conversation_root: runRoot,
      proposal: {
        protocol_version: 1,
        kind: 'shell_command_proposal',
        identity,
        command,
        cwd: runRoot,
        permission,
      },
      permission,
      shell,
      environment: { revision, entries: cleanEnvironmentEntries() },
      lifecycle_policy: 'terminate_with_run',
      hard_timeout_ms: hardTimeoutMs,
    },
  };
}

function send(child, request) {
  return new Promise((resolve, reject) => {
    child.send(request, error => error ? reject(error) : resolve());
  });
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function summarize(values) {
  return {
    min: Math.min(...values),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function startEventLoopSampler() {
  const samples = [];
  const intervalMs = 20;
  let expected = performance.now() + intervalMs;
  const timer = setInterval(() => {
    const actual = performance.now();
    samples.push(Math.max(0, actual - expected));
    expected = actual + intervalMs;
  }, intervalMs);
  return () => {
    clearInterval(timer);
    return samples.length === 0 ? { max: 0, p95: 0 } : {
      max: Math.max(...samples),
      p95: percentile(samples, 0.95),
    };
  };
}

function createRun(input) {
  const request = createStartRequest(input);
  const launchedAt = performance.now();
  const runner = fork(runnerPath, [JSON.stringify(platformRuntime())], {
    execPath: process.execPath,
    execArgv: [],
    env: { ...process.env },
    serialization: 'advanced',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  let startedAt;
  let outputBytes = 0;
  let outputPrefix = '';
  let shellReadyAt;
  let fixtureReadyAt;
  let terminal;
  let terminalCount = 0;
  let closedAt;
  let resolveStarted;
  let rejectStarted;
  let resolveClosed;
  let rejectClosed;
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  runner.stderr?.setEncoding('utf8');
  runner.stderr?.on('data', chunk => { diagnostics = `${diagnostics}${chunk}`.slice(-16_384); });
  runner.on('message', event => {
    if (event?.kind === 'command_runner_started') {
      startedAt = performance.now();
      resolveStarted();
    } else if (event?.kind === 'command_runner_output') {
      outputBytes += event.bytes?.byteLength ?? 0;
      if (event.channel === 'stdout' && outputPrefix.length < 4_096) {
        outputPrefix = `${outputPrefix}${new TextDecoder().decode(event.bytes)}`.slice(0, 4_096);
        if (shellReadyAt === undefined && outputPrefix.includes('__LINNYA_SHELL_PID__:')) {
          shellReadyAt = performance.now();
        }
        if (fixtureReadyAt === undefined && outputPrefix.includes('__LINNYA_FIXTURE_PID__:')) {
          fixtureReadyAt = performance.now();
        }
      }
    } else if (event?.kind === 'command_runner_terminal') {
      terminal = event.terminal;
      terminalCount += 1;
    }
  });
  runner.once('error', error => {
    rejectStarted(error);
    rejectClosed(error);
  });
  runner.once('close', (code, signal) => {
    closedAt = performance.now();
    if (!terminal) {
      const error = new Error(`runner ${runner.pid} closed without terminal: code=${code} signal=${signal}; ${diagnostics}`);
      rejectStarted(error);
      rejectClosed(error);
      return;
    }
    resolveClosed();
  });
  void send(runner, request).catch(error => {
    rejectStarted(error);
    rejectClosed(error);
  });
  return {
    pid: runner.pid,
    request,
    started,
    closed,
    stop: cause => send(runner, {
      protocol_version: 1,
      kind: 'command_runner_stop',
      identity: request.launch.proposal.identity,
      cause,
    }),
    kill: () => runner.kill('SIGKILL'),
    result: () => ({
      pid: runner.pid,
      startupMs: startedAt - launchedAt,
      shellReadyMs: shellReadyAt === undefined ? null : shellReadyAt - launchedAt,
      fixtureReadyMs: fixtureReadyAt === undefined ? null : fixtureReadyAt - launchedAt,
      durationMs: closedAt - launchedAt,
      outputBytes,
      outputPrefix,
      terminalCount,
      terminal,
      diagnostics,
    }),
  };
}

async function withDeadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function descendantsOf(records, rootPid) {
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (selected.has(record.parentPid) && !selected.has(record.pid)) {
        selected.add(record.pid);
        changed = true;
      }
    }
  }
  return records.filter(record => selected.has(record.pid) && record.pid !== rootPid);
}

async function snapshotProcesses(knownWindowsPids = []) {
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,%cpu=,comm='], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim().split(/\n/u).map(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/u);
      return match ? {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        rssBytes: Number(match[3]) * 1024,
        cpuPercent: Number(match[4]),
        handleCount: null,
        command: match[5],
      } : undefined;
    }).filter(record => record && record.command !== '/bin/ps');
  }
  if (knownWindowsPids.length === 0) return [];
  const source = [
    "$ProgressPreference = 'SilentlyContinue'",
    `$ids = @(${knownWindowsPids.join(',')})`,
    '$records = foreach ($targetId in $ids) {',
    '  $target = Get-Process -Id $targetId -ErrorAction SilentlyContinue',
    '  if ($null -ne $target) {',
    '    [pscustomobject]@{ pid=[int]$target.Id; parentPid=0; rssBytes=[long]$target.WorkingSet64; cpuMilliseconds=[double]$target.CPU * 1000; handleCount=[int]$target.HandleCount; command=[string]$target.ProcessName }',
    '  }',
    '}',
    '$records | ConvertTo-Json -Compress',
  ].join('\n');
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  const shell = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const { stdout } = await execFileAsync(shell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
  ], { maxBuffer: 8 * 1024 * 1024 });
  if (stdout.trim().length === 0) return [];
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(record => ({
    ...record,
    cpuPercent: null,
  }));
}

function collectKnownProcessIds(runs) {
  const ids = new Set(runs.map(run => run.pid));
  for (const run of runs) {
    const prefix = run.result().outputPrefix;
    for (const match of prefix.matchAll(/__LINNYA_(?:SHELL|FIXTURE|TREE_CHILD)_PID__:(\d+)/gu)) {
      ids.add(Number(match[1]));
    }
  }
  return [...ids];
}

async function waitForProcessMarkers(runs) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (runs.every(run => run.result().outputPrefix.includes('__LINNYA_FIXTURE_PID__:'))) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`workload process identity markers were not observed: ${JSON.stringify(
    runs.map(run => run.result()),
  )}`);
}

async function snapshotOwnedResources(runs) {
  const knownPids = collectKnownProcessIds(runs);
  const all = await snapshotProcesses(knownPids);
  const descendants = process.platform === 'darwin'
    ? descendantsOf(all, process.pid)
    : all;
  let handleCount = descendants.reduce((total, entry) => total + (entry.handleCount ?? 0), 0);
  if (process.platform === 'darwin' && descendants.length > 0) {
    const pidList = descendants.map(entry => entry.pid).join(',');
    const stdout = await new Promise((resolve, reject) => {
      execFile('/usr/sbin/lsof', ['-a', '-p', pidList, '-Fn'], {
        maxBuffer: 8 * 1024 * 1024,
      }, (error, output) => {
        // lsof 在采样期间有短命进程消失时返回 1，但已经输出的其他 PID 仍是有效证据。
        if (error && error.code !== 1) reject(error);
        else resolve(output);
      });
    });
    handleCount = stdout.split(/\n/u).filter(line => line.startsWith('f')).length;
  }
  return {
    processCount: descendants.length,
    rssBytes: descendants.reduce((total, entry) => total + entry.rssBytes, 0),
    cpuPercent: process.platform === 'darwin'
      ? descendants.reduce((total, entry) => total + entry.cpuPercent, 0)
      : null,
    cpuMilliseconds: process.platform === 'win32'
      ? descendants.reduce((total, entry) => total + (entry.cpuMilliseconds ?? 0), 0)
      : null,
    handleCount,
    pids: descendants.map(entry => entry.pid),
  };
}

async function waitForNoProcesses(pids) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const alive = new Set((await snapshotProcesses(pids)).map(record => record.pid));
    if (pids.every(pid => !alive.has(pid))) return 0;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const alive = new Set((await snapshotProcesses(pids)).map(record => record.pid));
  return pids.filter(pid => alive.has(pid)).length;
}

async function runGroup({ concurrency, scenario, round, runRoot }) {
  const groupRoot = path.join(runRoot, `${scenario}-${concurrency}-${round}`);
  await mkdir(groupRoot, { recursive: false });
  const scenarioArguments = scenario === 'quiet'
    ? [String(COMMAND_HOLD_MILLISECONDS)]
    : scenario === 'output'
      ? [String(OUTPUT_BYTES_PER_RUN), String(COMMAND_HOLD_MILLISECONDS)]
      : scenario === 'file'
        ? undefined
        : [];
  const hardTimeoutMs = 60_000;
  const stopLagSampler = startEventLoopSampler();
  const startedAt = performance.now();
  const runs = Array.from({ length: concurrency }, (_, index) => createRun({
    scenario: scenario === 'cancel' ? 'tree' : scenario,
    arguments: scenario === 'file'
      ? [path.join(groupRoot, `payload-${index}.bin`), String(FILE_BYTES_PER_RUN)]
      : scenarioArguments,
    hardTimeoutMs,
    runRoot,
  }));
  try {
    await withDeadline(Promise.all(runs.map(run => run.started)), GROUP_DEADLINE_MILLISECONDS, 'group start');
    await waitForProcessMarkers(runs);
    const peak = await snapshotOwnedResources(runs);
    if (scenario === 'cancel') await Promise.all(runs.map(run => run.stop('user_cancelled')));
    await withDeadline(Promise.all(runs.map(run => run.closed)), GROUP_DEADLINE_MILLISECONDS, 'group close');
    const eventLoopLagMs = stopLagSampler();
    const results = runs.map(run => run.result());
    results.forEach(result => {
      assert.equal(result.terminalCount, 1);
      assert.equal(result.terminal.outcome, 'execution_ended');
      assert.equal(
        result.terminal.termination_cause,
        scenario === 'cancel' ? 'user_cancelled' : 'natural_exit',
      );
      assert.equal(result.terminal.output_drain.status, 'complete');
      assert.equal(result.terminal.resource_release.status, 'succeeded');
    });
    const residualProcessCount = await waitForNoProcesses(peak.pids);
    assert.equal(residualProcessCount, 0);
    return {
      concurrency,
      scenario,
      round,
      wallMs: performance.now() - startedAt,
      startupMs: summarize(results.map(result => result.startupMs)),
      shellReadyMs: summarize(results.map(result => result.shellReadyMs)),
      fixtureReadyMs: summarize(results.map(result => result.fixtureReadyMs)),
      durationMs: summarize(results.map(result => result.durationMs)),
      outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
      eventLoopLagMs,
      peak,
      residualProcessCount,
    };
  } catch (error) {
    stopLagSampler();
    runs.forEach(run => run.kill());
    throw error;
  }
}

async function runTimeoutProbe(milliseconds, runRoot) {
  const run = createRun({
    scenario: 'tree',
    arguments: [],
    hardTimeoutMs: milliseconds,
    runRoot,
  });
  const startedAt = performance.now();
  try {
    await withDeadline(run.closed, 10_000, `timeout ${milliseconds}`);
    const result = run.result();
    assert.equal(result.terminalCount, 1);
    assert.equal(result.terminal.outcome, 'execution_ended');
    assert.equal(result.terminal.termination_cause, 'hard_timeout');
    assert.equal(result.terminal.tree_cleanup.status, 'succeeded');
    assert.equal(result.terminal.resource_release.status, 'succeeded');
    const observedProcessIds = collectKnownProcessIds([run]);
    const residualProcessCount = await waitForNoProcesses(observedProcessIds);
    assert.equal(residualProcessCount, 0);
    return {
      configuredMs: milliseconds,
      observedMs: performance.now() - startedAt,
      workloadTreeStarted: result.outputPrefix.includes('__LINNYA_TREE_CHILD_PID__:'),
      residualProcessCount,
      terminal: result.terminal,
    };
  } catch (error) {
    run.kill();
    throw error;
  }
}

function executableIfAvailable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return filePath;
  } catch {
    return null;
  }
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (directory.length === 0) continue;
    const candidate = path.join(directory, name);
    const executable = executableIfAvailable(candidate);
    if (executable) return executable;
  }
  return null;
}

async function runTaskCorpus(runRoot) {
  if (process.platform !== 'darwin') {
    return {
      status: 'not_run',
      reason: 'Windows clean ordinary-user channel does not contain the optional task CLIs',
      taskResults: [],
    };
  }
  const taskSpecs = [
    { id: 'image-sharp', scenario: 'image', arguments: [path.join(runRoot, 'corpus-image.png')] },
    { id: 'spreadsheet-xlsx', scenario: 'spreadsheet', arguments: [path.join(runRoot, 'corpus.xlsx')] },
    { id: 'slides-pptxgenjs', scenario: 'slides', arguments: [path.join(runRoot, 'corpus.pptx')] },
    { id: 'pdf-cupsfilter', scenario: 'pdf', arguments: [path.join(runRoot, 'corpus.pdf')] },
  ];
  const optionalExecutables = [
    { id: 'python-hash', scenario: 'python', path: findExecutable('python3') },
    { id: 'hermes-startup', scenario: 'external-cli-startup', path: findExecutable('hermes') },
    { id: 'codex-startup', scenario: 'external-cli-startup', path: findExecutable('codex') },
  ];
  for (const spec of optionalExecutables) {
    if (spec.path) taskSpecs.push({ id: spec.id, scenario: spec.scenario, arguments: [spec.path] });
  }
  const taskResults = [];
  for (const spec of taskSpecs) {
    const samples = [];
    for (let round = 1; round <= 3; round += 1) {
      const run = createRun({
        scenario: spec.scenario,
        arguments: spec.arguments,
        hardTimeoutMs: 60_000,
        runRoot,
      });
      await withDeadline(run.closed, 60_000, `task corpus ${spec.id}`);
      const result = run.result();
      assert.equal(result.terminal.outcome, 'execution_ended');
      assert.equal(result.terminal.termination_cause, 'natural_exit');
      samples.push(result.durationMs);
    }
    taskResults.push({ id: spec.id, durationMs: summarize(samples) });
  }
  return {
    status: 'completed',
    taskResults,
    unavailable: {
      ffmpeg: findExecutable('ffmpeg') === null,
      liveExternalAgentTurn: 'not_run_to_avoid_network_and_model-availability_noise',
    },
  };
}

async function main() {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-command-workload-'));
  const evidence = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    machine: {
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    configuration: {
      candidateConcurrency,
      timeoutProbeMilliseconds,
      rounds,
      commandHoldMilliseconds: COMMAND_HOLD_MILLISECONDS,
      outputBytesPerRun: OUTPUT_BYTES_PER_RUN,
      fileBytesPerRun: FILE_BYTES_PER_RUN,
    },
    groups: [],
    timeoutProbes: [],
    taskCorpus: undefined,
  };
  let completed = false;
  try {
    for (const concurrency of candidateConcurrency) {
      for (let round = 1; round <= rounds; round += 1) {
        for (const scenario of ['quiet', 'output', 'file', 'cancel']) {
          evidence.groups.push(await runGroup({ concurrency, scenario, round, runRoot }));
        }
      }
    }
    for (const milliseconds of timeoutProbeMilliseconds) {
      evidence.timeoutProbes.push(await runTimeoutProbe(milliseconds, runRoot));
    }
    evidence.taskCorpus = await runTaskCorpus(runRoot);
    completed = true;
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${outputPath}\n`);
  } finally {
    if (completed) await rm(runRoot, { recursive: true, force: true });
    else process.stderr.write(`workload failure preserved at ${runRoot}\n`);
  }
}

await main();
