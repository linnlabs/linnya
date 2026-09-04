import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { readMacosProcessInstance } from './harness/productionAgentProcessTree.mjs';
import { waitFor } from './harness/processObservation.mjs';

const execFileAsync = promisify(execFile);
const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/production-agent-pty/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runnerRoot = path.join(repositoryRoot, 'dist/main/commands');
const interactiveCliSourcePath = path.join(fixtureDirectory, 'interactive-cli.cjs');
const OUTPUT_LIMIT = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('production Agent PTY E2E currently runs on macOS');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function runProcess(file, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runChecked(file, args, options) {
  const result = await runProcess(file, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} ` +
        `stderr=${result.stderr} stdout=${result.stdout}`
    );
  }
  return result;
}

async function readJsonWhenAvailable(filePath, label, timeoutMs = 60_000) {
  return waitFor(
    label,
    async () => {
      try {
        return JSON.parse(await readFile(filePath, 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
        throw error;
      }
    },
    timeoutMs
  );
}

async function readMacosDescendantInstances(rootPid) {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=']);
  const records = stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/u);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]) }] : [];
  });
  const descendants = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (record.parentPid !== rootPid && !descendants.has(record.parentPid)) continue;
      if (descendants.has(record.pid)) continue;
      descendants.add(record.pid);
      changed = true;
    }
  }
  const instances = await Promise.all(Array.from(descendants, readMacosProcessInstance));
  return Object.freeze(instances.filter(Boolean));
}

async function sameProcessInstanceStillAlive(instance) {
  const current = await readMacosProcessInstance(instance.pid);
  return current?.startedAt === instance.startedAt && current.command === instance.command;
}

async function buildFixtureProject(projectRoot) {
  await mkdir(projectRoot, { recursive: true });
  await runChecked('pnpm', ['run', 'build:command-runner']);
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(fixtureDirectory, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:electron',
    '--external:better-sqlite3',
    '--external:node-pty',
    '--external:sharp',
    '--external:tiktoken',
    '--external:harfbuzzjs',
    '--external:yoga-layout',
    '--external:pdfjs-dist',
    '--external:@node-rs/jieba',
    '--alias:@plugin/backend=./src/plugin-sdk/backend',
    `--outfile=${path.join(projectRoot, 'main.cjs')}`,
  ]);
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'linnya-production-agent-pty-e2e',
      version: '1.0.0',
      private: true,
      main: 'main.cjs',
    }),
    'utf8'
  );
  await copyFile(
    path.join(
      repositoryRoot,
      'packages/plugins/slides/src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs'
    ),
    path.join(projectRoot, 'yogaRuntimeLoader.cjs')
  );
  await copyFile(
    path.join(
      repositoryRoot,
      'src/features/text-measurement/infrastructure/system/harfbuzzRuntimeLoader.cjs'
    ),
    path.join(projectRoot, 'harfbuzzRuntimeLoader.cjs')
  );
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(projectRoot, 'node_modules'));
}

async function main() {
  const isolated = await createIsolatedRunRoot('production-agent-pty');
  let child;
  let closed;
  let processOutcome;
  let observedDescendants = [];
  let primaryError;
  let electronStdout = '';
  let electronStderr = '';

  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const resultPath = path.join(isolated.path, 'result.json');
    const observationReadyPath = path.join(isolated.path, 'external-observation-ready');
    const workDirectoryHandshakePath = path.join(isolated.path, 'work-directory.json');
    const runToken = randomUUID();
    await buildFixtureProject(projectRoot);

    const electronBinary = path.join(
      repositoryRoot,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    );
    child = spawn(electronBinary, [projectRoot, '--no-error-dialogs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_PATH: path.join(repositoryRoot, 'node_modules'),
        LINNYA_AGENT_PTY_RESULT_PATH: resultPath,
        LINNYA_AGENT_PTY_RUN_ROOT: isolated.path,
        LINNYA_AGENT_PTY_RUNNER_ROOT: runnerRoot,
        LINNYA_AGENT_PTY_CLI_SOURCE_PATH: interactiveCliSourcePath,
        LINNYA_AGENT_PTY_NODE_EXECUTABLE: process.execPath,
        LINNYA_AGENT_PTY_RUN_TOKEN: runToken,
        LINNYA_AGENT_PTY_OBSERVATION_READY_PATH: observationReadyPath,
        LINNYA_AGENT_PTY_WORK_DIRECTORY_HANDSHAKE_PATH: workDirectoryHandshakePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => {
      electronStdout = appendBounded(electronStdout, chunk);
    });
    child.stderr.on('data', chunk => {
      electronStderr = appendBounded(electronStderr, chunk);
    });
    closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        processOutcome = { kind: 'electron_exit', code, signal };
        resolve({ code, signal });
      });
    });

    const resultPromise = readJsonWhenAvailable(resultPath, 'production Agent PTY result');
    const handshake = await readJsonWhenAvailable(
      workDirectoryHandshakePath,
      'production Agent PTY work-directory handshake'
    );
    assert.equal(handshake?.version, 1);
    assert.equal(handshake?.conversationId, 'conversation-agent-pty-e2e');
    assert.equal(typeof handshake?.absolutePath, 'string');
    const identityPath = path.join(handshake.absolutePath, 'pty-cli-identity.json');
    const identity = await readJsonWhenAvailable(identityPath, 'production Agent PTY CLI identity');
    assert.equal(identity?.version, 1);
    assert.equal(identity?.runToken, runToken);
    assert(Number.isSafeInteger(identity?.pid) && identity.pid > 0);

    const cliInstance = await readMacosProcessInstance(identity.pid);
    if (!cliInstance) {
      const [earlyResult, earlyExit] = await Promise.all([resultPromise, closed]);
      throw new Error(
        'PTY CLI exited before its external identity could be frozen; ' +
          `electron=${JSON.stringify(earlyExit)} result=${JSON.stringify(earlyResult)} ` +
          `stderr=${electronStderr} stdout=${electronStdout}`
      );
    }
    assert.equal(cliInstance.parentPid, identity.parentPid);
    assert(
      cliInstance.command.includes('interactive-cli.cjs'),
      `PTY CLI command identity is unexpected: ${cliInstance.command}`
    );
    assert(
      cliInstance.command.includes(runToken),
      `PTY CLI command does not contain this run token: ${cliInstance.command}`
    );
    observedDescendants = await readMacosDescendantInstances(child.pid);
    assert(
      observedDescendants.some(
        instance =>
          instance.pid === cliInstance.pid &&
          instance.startedAt === cliInstance.startedAt &&
          instance.command === cliInstance.command
      ),
      'PTY CLI must be an externally observed Electron descendant'
    );
    assert(
      observedDescendants.some(instance => instance.command.includes('--type=utility')),
      'the production PTY chain must include a disposable Electron Utility runner'
    );
    await writeFile(observationReadyPath, 'ready\n', 'utf8');

    const result = await resultPromise;
    const exit = await closed;
    assert.equal(exit.code, 0, electronStderr || electronStdout || JSON.stringify(result));
    assert.equal(result.success, true, result.error);
    assert(result.durableCommandRows >= 8 && result.durableCommandRows <= 21);
    assert(result.observationWaitCounts.ready >= 1 && result.observationWaitCounts.ready <= 4);
    assert(result.observationWaitCounts.submit >= 1 && result.observationWaitCounts.submit <= 4);
    assert(result.observationWaitCounts.resize >= 1 && result.observationWaitCounts.resize <= 4);
    assert(
      result.observationWaitCounts.terminal >= 1 && result.observationWaitCounts.terminal <= 4
    );
    assert.equal(result.commandCardState, 'completed');
    assert.equal(result.lastProcessAction, 'poll');
    assert.equal(result.terminalOutcome, 'exited');
    assert.equal(result.terminalExitCode, 0);
    assert.equal(result.screenColumns, 100);
    assert.equal(result.screenRows, 31);
    assert.equal(result.cliPid, identity.pid);

    await waitFor(
      'all frozen Electron descendants exit',
      async () => {
        const alive = await Promise.all(observedDescendants.map(sameProcessInstanceStillAlive));
        return alive.every(value => !value);
      },
      8_000
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          externallyObservedElectronDescendants: observedDescendants.length,
          externallyExitedElectronDescendants: observedDescendants.length,
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  if (child?.pid && processOutcome === undefined) {
    try {
      child.kill('SIGKILL');
      await waitFor(
        'production Agent PTY Electron exit during teardown',
        () => processOutcome,
        5_000
      );
      await closed;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const instance of [...observedDescendants].reverse()) {
    try {
      if (await sameProcessInstanceStillAlive(instance)) process.kill(instance.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') cleanupErrors.push(error);
    }
  }
  try {
    await isolated.cleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryError) {
    if (cleanupErrors.length > 0) throw new AggregateError([primaryError, ...cleanupErrors]);
    throw primaryError;
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors);
}

await main();
