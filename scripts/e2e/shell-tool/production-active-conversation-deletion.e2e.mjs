import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
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
  new URL('./fixtures/production-active-conversation-deletion/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runnerRoot = path.join(repositoryRoot, 'dist/main/commands');
const OUTPUT_LIMIT = 256 * 1024;
const TARGET_CONVERSATION_ID = 'conversation-active-deletion-e2e';
const OTHER_CONVERSATION_ID = 'conversation-active-deletion-other-e2e';

if (process.platform !== 'darwin') {
  throw new Error('production active conversation deletion E2E currently runs on macOS');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function runProcess(file, args, { cwd = repositoryRoot, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function runChecked(file, args) {
  const result = await runProcess(file, args);
  if (result.code !== 0) {
    throw new Error(
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} stderr=${result.stderr}`
    );
  }
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

function assertWithinRoot(candidate, root, label) {
  assert(path.isAbsolute(candidate), `${label} must be absolute`);
  const relative = path.relative(root, candidate);
  assert(
    relative.length > 0 &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `${label} must stay inside this isolated root`
  );
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function main() {
  const isolated = await createIsolatedRunRoot('production-active-conversation-deletion');
  let child;
  let closed;
  let processOutcome;
  let observation;
  let primaryError;
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const appDataRoot = path.join(isolated.path, 'app-data');
    const resultPath = path.join(isolated.path, 'result.json');
    const handshakePath = path.join(isolated.path, 'deletion-handshake.json');
    const controllerDonePath = path.join(isolated.path, 'controller-done.json');
    const runToken = randomUUID();
    const evidenceDirectoryName = `process-tree-${runToken}`;
    const command = createProductionAgentProcessTreeCommand({ evidenceDirectoryName, runToken });

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
        name: 'linnya-production-active-conversation-deletion-e2e',
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
        LINNYA_ACTIVE_DELETION_RESULT_PATH: resultPath,
        LINNYA_ACTIVE_DELETION_RUN_ROOT: isolated.path,
        LINNYA_ACTIVE_DELETION_RUNNER_ROOT: runnerRoot,
        LINNYA_ACTIVE_DELETION_COMMAND: command,
        LINNYA_ACTIVE_DELETION_HANDSHAKE_PATH: handshakePath,
        LINNYA_ACTIVE_DELETION_CONTROLLER_DONE_PATH: controllerDonePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    const resultPromise = readJsonWhenAvailable(
      resultPath,
      'production active conversation deletion result'
    );
    const handshake = await readJsonWhenAvailable(
      handshakePath,
      'production active conversation deletion handshake'
    );
    assert.equal(handshake?.version, 1);
    assert.equal(handshake?.conversationId, TARGET_CONVERSATION_ID);
    assert.equal(handshake?.otherConversationId, OTHER_CONVERSATION_ID);
    assert.equal(typeof handshake?.baseUrl, 'string');
    assert.match(handshake.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal(typeof handshake?.absolutePath, 'string');
    assert.equal(typeof handshake?.otherAbsolutePath, 'string');
    assertWithinRoot(handshake.absolutePath, appDataRoot, 'target conversation directory');
    assertWithinRoot(handshake.otherAbsolutePath, appDataRoot, 'other conversation directory');

    observation = await observeMacosProductionAgentProcessTree({
      runRoot: path.join(handshake.absolutePath, evidenceDirectoryName),
      runToken,
      readProcessOutcome: () => processOutcome,
      timeoutMs: 8_000,
    });

    const deletionUrl = `${handshake.baseUrl}/api/v1/conversation/${encodeURIComponent(
      TARGET_CONVERSATION_ID
    )}`;
    const firstDelete = await fetch(deletionUrl, { method: 'DELETE' });
    const firstBody = await firstDelete.json();
    assert.equal(firstDelete.status, 200, JSON.stringify(firstBody));
    assert.equal(firstBody?.success, true);
    const exited = await assertMacosProductionAgentProcessTreeExited(observation, {
      timeoutMs: 8_000,
      verifyHeartbeatStopped: false,
    });
    assert.equal(exited.exitedProcessCount, 3);
    assert.equal(await pathExists(handshake.absolutePath), false);
    assert.equal(await pathExists(handshake.otherAbsolutePath), true);

    const secondDelete = await fetch(deletionUrl, { method: 'DELETE' });
    const secondBody = await secondDelete.json();
    assert.equal(secondDelete.status, 404, JSON.stringify(secondBody));
    assert.equal(secondBody?.success, false);
    await writeFile(
      controllerDonePath,
      JSON.stringify({
        version: 1,
        firstDeleteStatus: firstDelete.status,
        secondDeleteStatus: secondDelete.status,
      })
    );

    const result = await resultPromise;
    const exit = await closed;
    assert.equal(exit.code, 0, stderr || JSON.stringify(result));
    assert.equal(result.success, true, result.error);
    assert.equal(result.firstDeleteStatus, 200);
    assert.equal(result.secondDeleteStatus, 404);
    assert.equal(result.targetActiveFlowRuns, 0);
    assert.equal(result.oldHandleStatus, 'rejected');
    assert.equal(result.oldHandleCode, 'unknown_handle');
    assert.equal(result.otherConversationPreserved, true);
    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          externalProcessGroupId: observation.processGroupId,
          externallyObservedProcesses: observation.instances.length,
          externallyExitedProcesses: exited.exitedProcessCount,
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
      await waitFor('active deletion Electron exit during teardown', () => processOutcome, 5_000);
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
        verifyHeartbeatStopped: false,
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
      'active conversation deletion validation and teardown both failed'
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'active conversation deletion teardown failed');
  }
}

await main();
