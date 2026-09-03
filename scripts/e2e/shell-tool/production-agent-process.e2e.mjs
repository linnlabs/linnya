import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  assertMacosProductionAgentProcessTreeExited,
  createProductionAgentProcessTreeCommand,
  isMacosProcessGroupAlive,
  observeMacosProductionAgentProcessTree,
} from './harness/productionAgentProcessTree.mjs';
import { waitFor } from './harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/production-agent-process/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runnerRoot = path.join(repositoryRoot, 'dist/main/commands');
const OUTPUT_LIMIT = 256 * 1024;
const EXPECTED_START = 'production-agent-parent-start';
const EXPECTED_TICK = 'production-agent-parent-tick-';
const EXPECTED_INTERACTION_PROMPT = 'interaction-request: enter value >';
const EXPECTED_INTERACTION_STDIN = 'interaction-stdin:eof';

if (process.platform !== 'darwin') {
  throw new Error('production Agent process E2E currently runs on macOS');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function runProcess(
  file,
  args,
  { cwd = repositoryRoot, env = process.env, timeoutMs = 120_000 } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} stderr=${result.stderr}`
    );
  }
  return result;
}

async function readWorkDirectoryHandshake(handshakePath, expectedAppDataRoot) {
  const handshake = await waitFor(
    'production conversation work-directory handshake',
    async () => {
      try {
        return JSON.parse(await readFile(handshakePath, 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
        throw error;
      }
    },
    60_000
  );
  assert.equal(handshake?.version, 1, 'work-directory handshake version must be 1');
  assert.equal(
    handshake?.conversationId,
    'conversation-agent-process-e2e',
    'work-directory handshake must belong to this scenario conversation'
  );
  assert.equal(
    typeof handshake?.absolutePath,
    'string',
    'work-directory handshake must publish an absolute path'
  );
  assert(path.isAbsolute(handshake.absolutePath), 'conversation work directory must be absolute');
  const relativePath = path.relative(expectedAppDataRoot, handshake.absolutePath);
  assert(
    relativePath.length > 0 &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath),
    'conversation work directory must stay inside this isolated app-data root'
  );
  return handshake;
}

async function main() {
  const isolated = await createIsolatedRunRoot('production-agent-process');
  let child;
  let closed;
  let processOutcome;
  let observation;
  let primaryError;
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const appDataRoot = path.join(isolated.path, 'app-data');
    const resultPath = path.join(isolated.path, 'result.json');
    const observationReadyPath = path.join(isolated.path, 'external-observation-ready');
    const workDirectoryHandshakePath = path.join(isolated.path, 'work-directory.json');
    const runToken = randomUUID();
    const evidenceDirectoryName = `process-tree-${runToken}`;
    const command = createProductionAgentProcessTreeCommand({
      evidenceDirectoryName,
      runToken,
    });
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
      '--external:pdfjs-dist/legacy/build/pdf',
      '--external:@node-rs/jieba',
      '--alias:@plugin/backend=./src/plugin-sdk/backend',
      `--outfile=${path.join(projectRoot, 'main.cjs')}`,
    ]);
    await writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'linnya-production-agent-process-e2e',
        version: '1.0.0',
        private: true,
        main: 'main.cjs',
      })
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
    await symlink(
      path.join(repositoryRoot, 'node_modules'),
      path.join(projectRoot, 'node_modules')
    );

    const electronBinary = path.join(
      repositoryRoot,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    );
    child = spawn(electronBinary, [projectRoot, '--no-error-dialogs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_PATH: path.join(repositoryRoot, 'node_modules'),
        LINNYA_AGENT_PROCESS_RESULT_PATH: resultPath,
        LINNYA_AGENT_PROCESS_RUN_ROOT: isolated.path,
        LINNYA_AGENT_PROCESS_RUNNER_ROOT: runnerRoot,
        LINNYA_AGENT_PROCESS_COMMAND: command,
        LINNYA_AGENT_PROCESS_EXPECTED_START: EXPECTED_START,
        LINNYA_AGENT_PROCESS_EXPECTED_TICK: EXPECTED_TICK,
        LINNYA_AGENT_PROCESS_EXPECTED_INTERACTION_PROMPT: EXPECTED_INTERACTION_PROMPT,
        LINNYA_AGENT_PROCESS_EXPECTED_INTERACTION_STDIN: EXPECTED_INTERACTION_STDIN,
        LINNYA_AGENT_PROCESS_OBSERVATION_READY_PATH: observationReadyPath,
        LINNYA_AGENT_PROCESS_WORK_DIRECTORY_HANDSHAKE_PATH: workDirectoryHandshakePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const handshakePromise = readWorkDirectoryHandshake(workDirectoryHandshakePath, appDataRoot);
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr = appendBounded(stderr, chunk);
    });
    closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        processOutcome = { kind: 'electron_exit', code, signal };
        resolve({ code, signal });
      });
    });
    const resultPromise = waitFor(
      'production Agent process result',
      async () => {
        try {
          return JSON.parse(await readFile(resultPath, 'utf8'));
        } catch (error) {
          if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
          throw error;
        }
      },
      60_000
    );
    try {
      const handshake = await handshakePromise;
      observation = await observeMacosProductionAgentProcessTree({
        runRoot: path.join(handshake.absolutePath, evidenceDirectoryName),
        runToken,
        readProcessOutcome: () => processOutcome,
        timeoutMs: 8_000,
      });
    } catch (error) {
      const [result, exit] = await Promise.all([resultPromise, closed]);
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `process-tree observation failed: ${cause}; electron=${JSON.stringify(exit)}; ` +
          `result=${JSON.stringify(result)}; stderr=${stderr}`
      );
    }
    await writeFile(observationReadyPath, 'ready\n');
    const result = await resultPromise;
    const exit = await closed;
    assert.equal(exit.code, 0, stderr || JSON.stringify(result));
    assert.equal(result.success, true, result.error);
    assert.equal(result.durableCommandRows, 4);
    assert.equal(result.commandCardState, 'completed');
    assert.equal(result.terminalOutcome, 'terminated');
    assert.equal(result.terminalReason, 'cancelled');
    assert.equal(result.lastProcessAction, 'cancel');
    assert.equal(result.promptLikeOutputObserved, true);
    assert.equal(result.childStdinEofObserved, true);
    assert.equal(result.silentWaitReturnedRunning, true);
    assert.equal(result.automaticInputActions, 0);
    assert(result.commandAuditActions.includes('command.process.action'));
    assert.equal(
      result.commandAuditActions.filter(action => action === 'command.execution.terminal').length,
      1
    );
    const cleanup = await assertMacosProductionAgentProcessTreeExited(observation, {
      timeoutMs: 8_000,
    });
    assert.equal(cleanup.exitedProcessCount, 3);
    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          externalProcessGroupId: observation.processGroupId,
          externallyObservedProcesses: observation.instances.length,
          externallyExitedProcesses: cleanup.exitedProcessCount,
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
      await waitFor('production Agent Electron exit during teardown', () => processOutcome, 5_000);
      await closed;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (observation) {
    try {
      if (isMacosProcessGroupAlive(observation.processGroupId)) {
        process.kill(-observation.processGroupId, 'SIGKILL');
      }
      await assertMacosProductionAgentProcessTreeExited(observation, {
        timeoutMs: 8_000,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await isolated.cleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'production Agent process validation and teardown both failed'
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'production Agent process teardown failed');
  }
}

await main();
