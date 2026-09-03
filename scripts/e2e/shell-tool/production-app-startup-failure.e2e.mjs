import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  isSameMacosProcessInstanceAlive,
  readMacosDescendantInstances,
} from './harness/macosElectronProcessObservation.mjs';
import { waitFor } from './harness/processObservation.mjs';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const OUTPUT_LIMIT = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('production App startup failure E2E currently runs on macOS');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function startProcess(file, args, { cwd, env, timeoutMs = 60_000 }) {
  const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let closed = false;
  const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      closed = true;
      resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, completion, isClosed: () => closed };
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function main() {
  const isolated = await createIsolatedRunRoot('production-app-startup-failure');
  const frozenDescendants = new Map();
  let running;
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const distMainRoot = path.join(projectRoot, 'dist', 'main');
    const userDataRoot = path.join(isolated.path, 'electron-user-data');
    await mkdir(distMainRoot, { recursive: true });
    await mkdir(userDataRoot, { recursive: true });
    await copyFile(
      path.join(repositoryRoot, 'dist', 'main', 'main.cjs'),
      path.join(distMainRoot, 'main.cjs'),
    );
    await copyFile(
      path.join(
        repositoryRoot,
        'packages/plugins/slides/src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs',
      ),
      path.join(distMainRoot, 'yogaRuntimeLoader.cjs'),
    );
    await copyFile(
      path.join(
        repositoryRoot,
        'src/features/text-measurement/infrastructure/system/harfbuzzRuntimeLoader.cjs',
      ),
      path.join(distMainRoot, 'harfbuzzRuntimeLoader.cjs'),
    );
    await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
      name: 'linnya-production-app-startup-failure-e2e',
      version: '1.0.0',
      private: true,
      main: 'dist/main/main.cjs',
    }), 'utf8');
    await symlink(path.join(repositoryRoot, 'node_modules'), path.join(projectRoot, 'node_modules'));

    // 故意不复制 App Server CJS：验证正式 app-lifecycle 在建窗前阻断缺失 sidecar。
    const electronBinary = path.join(
      repositoryRoot,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    );
    running = startProcess(
      electronBinary,
      [projectRoot, `--user-data-dir=${userDataRoot}`, '--no-error-dialogs'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          LINNYA_DEV_MODE: 'true',
          LINNYA_API_PORT: '31873',
        },
      },
    );

    while (!running.isClosed()) {
      const descendants = await readMacosDescendantInstances(running.child.pid);
      for (const instance of descendants) {
        frozenDescendants.set(`${instance.pid}:${instance.startedAt}`, instance);
      }
      await delay(5);
    }
    const result = await running.completion;

    assert.equal(result.signal, null, `startup failure was force-killed: ${result.stderr}`);
    assert.equal(result.code, 1, `startup failure must exit 1: ${result.stderr} ${result.stdout}`);
    const backendLog = await readOptionalText(path.join(userDataRoot, 'logs', 'backend.log'));
    const lifecycleEvidence = `${backendLog}\n${result.stderr}\n${result.stdout}`;
    assert.match(lifecycleEvidence, /STEP 1 \(FAILED\)|启动失败，开始收口已创建资源/u);
    assert.doesNotMatch(lifecycleEvidence, /STEP 3 \(START\).*Creating main browser window/u);
    assert.ok(frozenDescendants.size > 0, 'must freeze Electron helper instances before root exit');
    await waitFor('startup failure 后所有冻结 Electron 后代退出', async () => {
      const alive = await Promise.all(
        Array.from(frozenDescendants.values(), isSameMacosProcessInstanceAlive),
      );
      return alive.every(value => !value);
    }, 10_000);

    process.stdout.write(`${JSON.stringify({
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      exitCode: result.code,
      signal: result.signal,
      missingBackendBundle: true,
      mainWindowCreated: false,
      frozenElectronDescendants: frozenDescendants.size,
      remainingFrozenDescendants: 0,
    }, null, 2)}\n`);
  } finally {
    if (running && !running.isClosed()) {
      running.child.kill('SIGKILL');
      await running.completion.catch(() => undefined);
    }
    for (const instance of frozenDescendants.values()) {
      if (await isSameMacosProcessInstanceAlive(instance)) process.kill(instance.pid, 'SIGKILL');
    }
    await isolated.cleanup();
  }
}

await main();
