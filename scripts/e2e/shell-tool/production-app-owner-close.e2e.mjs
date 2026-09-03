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
} from './harness/productionAgentProcessTree.mjs';
import { waitFor } from './harness/processObservation.mjs';
import {
  isSameMacosProcessInstanceAlive,
  readMacosDescendantInstances,
} from './harness/macosElectronProcessObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/production-app-owner-close/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runnerRoot = path.join(repositoryRoot, 'dist/main/commands');
const OUTPUT_LIMIT = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('production App owner close E2E currently runs on macOS');
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

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function waitForHeartbeatAfterClose(observation, previousSize) {
  await waitFor(
    '返回继续后命令心跳继续增长',
    async () => {
      const current = await stat(observation.instances[0].heartbeatPath);
      return current.size > previousSize;
    },
    5_000
  );
}

async function buildFixtureProject(projectRoot) {
  const distMainRoot = path.join(projectRoot, 'dist', 'main');
  const distRendererRoot = path.join(projectRoot, 'dist', 'renderer');
  await mkdir(distMainRoot, { recursive: true });
  await mkdir(distRendererRoot, { recursive: true });
  await runChecked('pnpm', ['run', 'build:command-runner']);
  const sharedBuildArgs = [
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:electron',
  ];
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(fixtureDirectory, 'main.ts'),
    ...sharedBuildArgs,
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
    `--outfile=${path.join(distMainRoot, 'main.cjs')}`,
  ]);
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(repositoryRoot, 'src/electron-main/preload/index.ts'),
    ...sharedBuildArgs,
    `--outfile=${path.join(distMainRoot, 'preload.js')}`,
  ]);
  await writeFile(
    path.join(distRendererRoot, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>fixture-loaded</title>
<script>
let closeRequestCount = 0;
let pendingCloseRequest;
window.initializeCloseFixture = () => {
  window.electronAPI.onWindowCloseRequest(request => {
    closeRequestCount += 1;
    if (closeRequestCount === 1) {
      window.electronAPI.completeWindowClosePreparation(request.request_id, 'save_failed');
      requestAnimationFrame(() => { document.title = 'renderer-save-failed'; });
      return;
    }
    pendingCloseRequest = request;
    document.title = 'renderer-slow-save-pending';
  });
  window.electronAPI.markWindowCloseRendererReady();
  document.title = 'renderer-ready';
};
window.completeSlowSave = () => {
  if (!pendingCloseRequest) throw new Error('slow save request is not pending');
  window.electronAPI.completeWindowClosePreparation(pendingCloseRequest.request_id, 'ready');
  document.title = 'renderer-slow-save-completed';
};
</script>`,
    'utf8'
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'linnya-production-app-owner-close-e2e',
      version: '1.0.0',
      private: true,
      main: 'dist/main/main.cjs',
    }),
    'utf8'
  );
  await copyFile(
    path.join(
      repositoryRoot,
      'packages/plugins/slides/src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs'
    ),
    path.join(distMainRoot, 'yogaRuntimeLoader.cjs')
  );
  await copyFile(
    path.join(
      repositoryRoot,
      'src/features/text-measurement/infrastructure/system/harfbuzzRuntimeLoader.cjs'
    ),
    path.join(distMainRoot, 'harfbuzzRuntimeLoader.cjs')
  );
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(projectRoot, 'node_modules'));
}

async function main() {
  const isolated = await createIsolatedRunRoot('production-app-owner-close');
  let child;
  let closed;
  let processOutcome;
  let pipeObservation;
  let ptyObservation;
  let primaryError;
  let electronStdout = '';
  let electronStderr = '';
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const resultPath = path.join(isolated.path, 'result.json');
    const handshakePath = path.join(isolated.path, 'handshake.json');
    const firstClosePath = path.join(isolated.path, 'first-close');
    const secondClosePath = path.join(isolated.path, 'second-close');
    const rendererReadyPath = path.join(isolated.path, 'renderer-ready');
    const retryClosePath = path.join(isolated.path, 'retry-close');
    const completeSlowSavePath = path.join(isolated.path, 'complete-slow-save');
    const eventLogPath = path.join(isolated.path, 'events.log');
    const pipeRunToken = randomUUID();
    const ptyRunToken = randomUUID();
    const pipeEvidenceDirectoryName = `pipe-tree-${pipeRunToken}`;
    const ptyEvidenceDirectoryName = `pty-tree-${ptyRunToken}`;
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
        LINNYA_APP_CLOSE_RUN_ROOT: isolated.path,
        LINNYA_APP_CLOSE_RESULT_PATH: resultPath,
        LINNYA_APP_CLOSE_HANDSHAKE_PATH: handshakePath,
        LINNYA_APP_CLOSE_RUNNER_ROOT: runnerRoot,
        LINNYA_APP_CLOSE_FIRST_PATH: firstClosePath,
        LINNYA_APP_CLOSE_SECOND_PATH: secondClosePath,
        LINNYA_APP_CLOSE_RENDERER_READY_PATH: rendererReadyPath,
        LINNYA_APP_CLOSE_RETRY_PATH: retryClosePath,
        LINNYA_APP_CLOSE_COMPLETE_SLOW_SAVE_PATH: completeSlowSavePath,
        LINNYA_APP_CLOSE_PIPE_COMMAND: createProductionAgentProcessTreeCommand({
          evidenceDirectoryName: pipeEvidenceDirectoryName,
          runToken: pipeRunToken,
        }),
        LINNYA_APP_CLOSE_PTY_COMMAND: createProductionAgentProcessTreeCommand({
          evidenceDirectoryName: ptyEvidenceDirectoryName,
          runToken: ptyRunToken,
        }),
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

    // 立即把 rejection 转成普通 settlement；否则 fixture 在 handshake 前失败时，
    // result timeout 会先成为 unhandled rejection，反而跳过本脚本自己的诊断与 cleanup。
    const resultSettlement = readJsonWhenAvailable(resultPath, 'production App close result').then(
      value => ({ status: 'fulfilled', value }),
      reason => ({ status: 'rejected', reason })
    );
    const handshake = await waitFor(
      'production App close handshake',
      async () => {
        const published = await readOptionalJson(handshakePath);
        if (published) return published;
        const earlyResult = await readOptionalJson(resultPath);
        if (earlyResult?.success === false) {
          throw new Error(`fixture failed before handshake: ${earlyResult.error}`);
        }
        if (processOutcome) {
          throw new Error(
            `Electron exited before handshake: ${JSON.stringify(processOutcome)} ` +
              `stderr=${electronStderr} stdout=${electronStdout}`
          );
        }
        return undefined;
      },
      60_000
    );
    assert.equal(handshake?.version, 1);
    assert.equal(handshake?.electronPid, child.pid);
    assert.equal(typeof handshake?.workDirectory, 'string');

    [pipeObservation, ptyObservation] = await Promise.all([
      observeMacosProductionAgentProcessTree({
        runRoot: path.join(handshake.workDirectory, pipeEvidenceDirectoryName),
        runToken: pipeRunToken,
        readProcessOutcome: () => processOutcome,
        timeoutMs: 10_000,
      }),
      observeMacosProductionAgentProcessTree({
        runRoot: path.join(handshake.workDirectory, ptyEvidenceDirectoryName),
        runToken: ptyRunToken,
        readProcessOutcome: () => processOutcome,
        timeoutMs: 10_000,
      }),
    ]);
    const descendants = await readMacosDescendantInstances(child.pid);
    const utilityProcesses = descendants.filter(instance =>
      instance.command.includes('--type=utility')
    );
    assert(utilityProcesses.length >= 2, 'pipe 与 PTY 应各有一个正式 disposable Utility runner');

    const heartbeatSizeBeforeReturn = (await stat(pipeObservation.instances[0].heartbeatPath)).size;
    await writeFile(firstClosePath, '', 'utf8');
    await waitFor(
      '第一次关闭选择返回并保持窗口',
      async () => {
        const events = await readOptionalText(eventLogPath);
        return (
          events.includes('decision=return') && events.includes('first-close-window-open=true')
        );
      },
      10_000
    );
    assert.equal(processOutcome, undefined, '返回继续不能退出 Electron App');
    assert.equal(isMacosProcessGroupAlive(pipeObservation.processGroupId), true);
    assert.equal(isMacosProcessGroupAlive(ptyObservation.processGroupId), true);
    await waitForHeartbeatAfterClose(pipeObservation, heartbeatSizeBeforeReturn);

    // 第二次关闭先于 renderer readiness，主进程必须等待正式 preload 握手，不能丢消息或退出。
    await writeFile(secondClosePath, '', 'utf8');
    await waitFor(
      'renderer 未就绪时关闭保持 App 与命令树',
      async () => {
        const events = await readOptionalText(eventLogPath);
        return events.includes('second-close-waiting-renderer-ready=true');
      },
      10_000
    );
    assert.equal(processOutcome, undefined);
    assert.equal(isMacosProcessGroupAlive(pipeObservation.processGroupId), true);
    assert.equal(isMacosProcessGroupAlive(ptyObservation.processGroupId), true);

    await writeFile(rendererReadyPath, '', 'utf8');
    await waitFor(
      '第一次保存失败后窗口与 owner 保持',
      async () => {
        const events = await readOptionalText(eventLogPath);
        if (events.includes('renderer-initialize-error=')) {
          throw new Error(`renderer initialization failed: ${events}`);
        }
        return events.includes('renderer-save-failed');
      },
      10_000
    );
    assert.equal(processOutcome, undefined);
    assert.equal(isMacosProcessGroupAlive(pipeObservation.processGroupId), true);
    assert.equal(isMacosProcessGroupAlive(ptyObservation.processGroupId), true);

    await writeFile(retryClosePath, '', 'utf8');
    await waitFor(
      '第二次保存请求保持 pending',
      async () => {
        const events = await readOptionalText(eventLogPath);
        return (
          events.includes('renderer-slow-save-pending') &&
          events.includes('preparing-window-gate-blocked')
        );
      },
      10_000
    );
    assert.equal(processOutcome, undefined);
    assert.equal(isMacosProcessGroupAlive(pipeObservation.processGroupId), true);
    assert.equal(isMacosProcessGroupAlive(ptyObservation.processGroupId), true);

    await writeFile(completeSlowSavePath, '', 'utf8');
    const settledResult = await resultSettlement;
    if (settledResult.status === 'rejected') throw settledResult.reason;
    const result = settledResult.value;
    const exit = await closed;
    assert.deepEqual(
      exit,
      { code: 0, signal: null },
      electronStderr || electronStdout || JSON.stringify(result)
    );
    assert.equal(result.success, true, result.error);
    assert.equal(result.decisionCount, 3);
    assert.equal(result.shutdownWindowGateBlocked, true);
    assert.equal(result.pipeHandleAfterExit?.status, 'rejected');
    assert.equal(result.pipeHandleAfterExit?.code, 'owner_ended');
    assert.equal(result.ptyHandleAfterExit?.status, 'rejected');
    assert.equal(result.ptyHandleAfterExit?.code, 'owner_ended');

    const [pipeExited, ptyExited] = await Promise.all([
      assertMacosProductionAgentProcessTreeExited(pipeObservation, { timeoutMs: 10_000 }),
      assertMacosProductionAgentProcessTreeExited(ptyObservation, { timeoutMs: 10_000 }),
    ]);
    await waitFor(
      'Electron main、renderer、Utility 与命令后代原始实例全部退出',
      async () => {
        const alive = await Promise.all(descendants.map(isSameMacosProcessInstanceAlive));
        return alive.every(value => !value);
      },
      10_000
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          returnPreservedBothTrees: true,
          rendererReadyWaited: true,
          saveFailureRetried: true,
          slowSavePreservedBothTrees: true,
          shutdownWindowGateBlocked: result.shutdownWindowGateBlocked,
          pipeExitedProcesses: pipeExited.exitedProcessCount,
          ptyExitedProcesses: ptyExited.exitedProcessCount,
          frozenElectronDescendants: descendants.length,
          frozenUtilityProcesses: utilityProcesses.length,
          remainingFrozenDescendants: 0,
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
      await waitFor('App close Electron teardown', () => processOutcome, 5_000);
      await closed;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const observation of [pipeObservation, ptyObservation].filter(Boolean)) {
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
      'production App close validation and teardown both failed'
    );
  }
  if (primaryError) {
    throw new Error(
      `${primaryError instanceof Error ? (primaryError.stack ?? primaryError.message) : String(primaryError)}\n` +
        `Electron stderr=${electronStderr}\nElectron stdout=${electronStdout}`,
      { cause: primaryError }
    );
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'production App close teardown failed');
  }
}

await main();
