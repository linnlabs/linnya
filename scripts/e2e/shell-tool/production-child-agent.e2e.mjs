import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  assertMacosProductionAgentProcessTreeExited,
  createProductionAgentProcessTreeCommand,
  isMacosProcessGroupAlive,
  observeMacosProductionAgentProcessTree,
  quoteZshArgument,
} from './harness/productionAgentProcessTree.mjs';
import { waitFor } from './harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/production-child-agent/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runnerRoot = path.join(repositoryRoot, 'dist/main/commands');
const OUTPUT_LIMIT = 256 * 1024;
const CONVERSATION_ID = 'conversation-production-child-agent-e2e';

if (process.platform !== 'darwin') {
  throw new Error('production child Agent E2E currently runs on macOS');
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

async function readMilestoneOrFixtureFailure(filePath, label, resultPromise) {
  return Promise.race([
    readJsonWhenAvailable(filePath, label),
    resultPromise.then(result => {
      throw new Error(`fixture exited before ${label}: ${result?.error ?? JSON.stringify(result)}`);
    }),
  ]);
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

function createChildCommand(treeCommand) {
  return [
    'printf',
    quoteZshArgument('created-by-child\n'),
    '>',
    quoteZshArgument('child-agent-created.txt'),
    '&&',
    'printf',
    quoteZshArgument('production-child-agent-child-start\n'),
    '&&',
    treeCommand,
  ].join(' ');
}

async function heartbeatSize(observation) {
  const parent = observation.instances.find(instance => instance.role === 'parent');
  assert(parent, 'process-tree observation must include its parent');
  return (await stat(parent.heartbeatPath)).size;
}

async function main() {
  const isolated = await createIsolatedRunRoot('production-child-agent');
  let electron;
  let closed;
  let processOutcome;
  let rootObservation;
  let childObservation;
  let primaryError;
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const appDataRoot = path.join(isolated.path, 'app-data');
    const resultPath = path.join(isolated.path, 'result.json');
    const handshakePath = path.join(isolated.path, 'handshake.json');
    const overlapObservedPath = path.join(isolated.path, 'overlap-observed');
    const rootReadyPath = path.join(isolated.path, 'root-ready.json');
    const deleteReadyPath = path.join(isolated.path, 'delete-ready.json');
    const controllerDonePath = path.join(isolated.path, 'controller-done.json');
    const rootRunToken = randomUUID();
    const childRunToken = randomUUID();
    const rootEvidenceDirectoryName = `root-tree-${rootRunToken}`;
    const childEvidenceDirectoryName = `child-tree-${childRunToken}`;
    const rootCommand = createProductionAgentProcessTreeCommand({
      evidenceDirectoryName: rootEvidenceDirectoryName,
      runToken: rootRunToken,
    });
    const childCommand = createChildCommand(
      createProductionAgentProcessTreeCommand({
        evidenceDirectoryName: childEvidenceDirectoryName,
        runToken: childRunToken,
      })
    );

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
        name: 'linnya-production-child-agent-e2e',
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
    electron = spawn(electronBinary, [projectRoot, '--no-error-dialogs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_PATH: path.join(repositoryRoot, 'node_modules'),
        LINNYA_CHILD_AGENT_RESULT_PATH: resultPath,
        LINNYA_CHILD_AGENT_RUN_ROOT: isolated.path,
        LINNYA_CHILD_AGENT_RUNNER_ROOT: runnerRoot,
        LINNYA_CHILD_AGENT_ROOT_COMMAND: rootCommand,
        LINNYA_CHILD_AGENT_CHILD_COMMAND: childCommand,
        LINNYA_CHILD_AGENT_HANDSHAKE_PATH: handshakePath,
        LINNYA_CHILD_AGENT_OVERLAP_OBSERVED_PATH: overlapObservedPath,
        LINNYA_CHILD_AGENT_ROOT_READY_PATH: rootReadyPath,
        LINNYA_CHILD_AGENT_DELETE_READY_PATH: deleteReadyPath,
        LINNYA_CHILD_AGENT_CONTROLLER_DONE_PATH: controllerDonePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    electron.stderr.on('data', chunk => {
      stderr = appendBounded(stderr, chunk);
    });
    closed = new Promise((resolve, reject) => {
      electron.once('error', reject);
      electron.once('close', (code, signal) => {
        processOutcome = { kind: 'electron_exit', code, signal };
        resolve({ code, signal });
      });
    });
    const resultPromise = readJsonWhenAvailable(resultPath, 'production child Agent result');
    const handshake = await readMilestoneOrFixtureFailure(
      handshakePath,
      'production child Agent handshake',
      resultPromise
    );
    assert.equal(handshake?.version, 1);
    assert.equal(handshake?.conversationId, CONVERSATION_ID);
    assert.equal(typeof handshake?.absolutePath, 'string');
    assertWithinRoot(handshake.absolutePath, appDataRoot, 'conversation work directory');
    assert.equal(typeof handshake?.baseUrl, 'string');
    assert.match(handshake.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);

    [rootObservation, childObservation] = await Promise.all([
      observeMacosProductionAgentProcessTree({
        runRoot: path.join(handshake.absolutePath, rootEvidenceDirectoryName),
        runToken: rootRunToken,
        readProcessOutcome: () => processOutcome,
        timeoutMs: 10_000,
      }),
      observeMacosProductionAgentProcessTree({
        runRoot: path.join(handshake.absolutePath, childEvidenceDirectoryName),
        runToken: childRunToken,
        readProcessOutcome: () => processOutcome,
        timeoutMs: 10_000,
      }),
    ]);
    assert.notEqual(
      rootObservation.processGroupId,
      childObservation.processGroupId,
      'root and child commands must be separately owned process groups'
    );
    const rootHeartbeatBeforeChildCleanup = await heartbeatSize(rootObservation);
    await writeFile(overlapObservedPath, 'ready\n');

    await readMilestoneOrFixtureFailure(
      rootReadyPath,
      'root resumed after child cleanup',
      resultPromise
    );
    const childExited = await assertMacosProductionAgentProcessTreeExited(childObservation, {
      timeoutMs: 10_000,
    });
    assert.equal(childExited.exitedProcessCount, 3);
    assert.equal(isMacosProcessGroupAlive(rootObservation.processGroupId), true);
    await waitFor(
      'root sibling heartbeat after child cleanup',
      async () => (await heartbeatSize(rootObservation)) > rootHeartbeatBeforeChildCleanup,
      5_000
    );

    const deleteReady = await readMilestoneOrFixtureFailure(
      deleteReadyPath,
      'fixture durable validation before deletion',
      resultPromise
    );
    assert.equal(deleteReady?.version, 1);
    assert.notEqual(deleteReady?.rootRunId, deleteReady?.childRunId);
    assert.equal(deleteReady?.rootCommandRows, 2);
    assert.equal(deleteReady?.childCommandRows, 3);

    const deletionUrl = `${handshake.baseUrl}/api/v1/conversation/${encodeURIComponent(
      CONVERSATION_ID
    )}`;
    const deletionResponse = await globalThis.fetch(deletionUrl, { method: 'DELETE' });
    const deletionBody = await deletionResponse.json();
    assert.equal(deletionResponse.status, 200, JSON.stringify(deletionBody));
    assert.equal(deletionBody?.success, true);
    const rootExited = await assertMacosProductionAgentProcessTreeExited(rootObservation, {
      timeoutMs: 10_000,
      verifyHeartbeatStopped: false,
    });
    assert.equal(rootExited.exitedProcessCount, 3);
    await writeFile(
      controllerDonePath,
      JSON.stringify({
        version: 1,
        deleteStatus: deletionResponse.status,
      })
    );

    const result = await resultPromise;
    const exit = await closed;
    assert.equal(exit.code, 0, stderr || JSON.stringify(result));
    assert.equal(result.success, true, result.error);
    assert.equal(result.sameConversation, true);
    assert.equal(result.childParentIdentityVerified, true);
    assert.equal(result.rawByteArtifacts, 2);
    assert.equal(result.rendererRootCommandCards, 1);
    assert.equal(result.childFileCreated, true);
    assert.equal(result.conversationDeleted, true);
    assert.equal(result.oldRootHandleCode, 'unknown_handle');
    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          overlappingProcessTrees: 2,
          externallyObservedProcesses: 6,
          childExitedBeforeRoot: true,
          rootExitedOnConversationDelete: true,
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  if (electron?.pid && processOutcome === undefined) {
    try {
      electron.kill('SIGKILL');
      await waitFor('child Agent Electron exit during teardown', () => processOutcome, 5_000);
      await closed;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const observation of [rootObservation, childObservation]) {
    if (!observation) continue;
    try {
      if (isMacosProcessGroupAlive(observation.processGroupId)) {
        process.kill(-observation.processGroupId, 'SIGKILL');
      }
      await assertMacosProductionAgentProcessTreeExited(observation, {
        timeoutMs: 10_000,
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
      'production child Agent validation and teardown both failed'
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'production child Agent teardown failed');
  }
}

await main();
