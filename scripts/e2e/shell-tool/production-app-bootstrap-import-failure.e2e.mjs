import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
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
  throw new Error('production App bootstrap import failure E2E currently runs on macOS');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function startProcess(file, args, { cwd, env, timeoutMs = 60_000 }) {
  const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
  return { child, completion };
}

async function runChecked(file, args) {
  const running = startProcess(file, args, {
    cwd: repositoryRoot,
    env: process.env,
  });
  const result = await running.completion;
  assert.equal(result.timedOut, false, `${file} timed out: ${result.stderr}`);
  assert.equal(result.signal, null, `${file} was killed: ${result.stderr}`);
  assert.equal(result.code, 0, `${file} failed: ${result.stderr} ${result.stdout}`);
}

async function buildFixture(projectRoot) {
  const distMainRoot = path.join(projectRoot, 'dist', 'main');
  await mkdir(distMainRoot, { recursive: true });
  await runChecked(process.execPath, [
    'scripts/build/run-esbuild.mjs',
    'src/electron-main/index.js',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${path.join(distMainRoot, 'main.cjs')}`,
    '--external:electron',
    '--external:pdfjs-dist',
    '--external:@node-rs/jieba',
    '--external:better-sqlite3',
    '--external:yoga-layout',
    '--external:harfbuzzjs',
    // 保留生产动态 import，但故意不提供目标文件，直接验证入口的 rejection owner。
    '--external:./app-lifecycle.js',
  ]);
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'linnya-production-app-bootstrap-import-failure-e2e',
    version: '1.0.0',
    private: true,
    main: 'dist/main/main.cjs',
  }), 'utf8');
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(projectRoot, 'node_modules'));
}

async function runFailingPrimary(electronBinary, projectRoot, userDataRoot, attempt) {
  const running = startProcess(
    electronBinary,
    [projectRoot, `--user-data-dir=${userDataRoot}`, '--no-error-dialogs'],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        LINNYA_DEV_MODE: 'true',
      },
    },
  );
  const descendants = new Map();
  while (running.child.exitCode === null && running.child.signalCode === null) {
    for (const instance of await readMacosDescendantInstances(running.child.pid)) {
      descendants.set(`${instance.pid}:${instance.startedAt}`, instance);
    }
    await delay(5);
  }
  const result = await running.completion;
  assert.equal(result.timedOut, false, `attempt ${attempt} timed out: ${result.stderr}`);
  assert.equal(result.signal, null, `attempt ${attempt} was killed: ${result.stderr}`);
  assert.equal(result.code, 1, `attempt ${attempt} must exit 1: ${result.stderr}`);
  assert.equal(
    result.stderr.split('linnya.main.bootstrap_failed').length - 1,
    1,
    `attempt ${attempt} must settle bootstrap failure exactly once: ${result.stderr}`,
  );
  assert.doesNotMatch(result.stderr, /unhandled(?:Rejection| promise rejection)/iu);
  await waitFor(`attempt ${attempt} 后所有冻结 Electron 后代退出`, async () => {
    const alive = await Promise.all(
      Array.from(descendants.values(), isSameMacosProcessInstanceAlive),
    );
    return alive.every(value => !value);
  }, 10_000);
  return descendants.size;
}

async function main() {
  const isolated = await createIsolatedRunRoot('production-app-bootstrap-import-failure');
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const userDataRoot = path.join(isolated.path, 'electron-user-data');
    await buildFixture(projectRoot);

    const electronBinary = path.join(
      repositoryRoot,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    );
    const firstDescendants = await runFailingPrimary(
      electronBinary,
      projectRoot,
      userDataRoot,
      1,
    );
    // 第二次仍以 code 1 进入 primary bootstrap，证明第一次已经退出并释放单实例 owner；
    // 若旧 owner 仍在，它只会作为 secondary 正常退出且不会输出 bootstrap marker。
    const secondDescendants = await runFailingPrimary(
      electronBinary,
      projectRoot,
      userDataRoot,
      2,
    );

    process.stdout.write(`${JSON.stringify({
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      attempts: 2,
      exitCodes: [1, 1],
      bootstrapMarkers: 2,
      frozenElectronDescendants: firstDescendants + secondDescendants,
      remainingFrozenDescendants: 0,
      primaryOwnerReacquired: true,
    }, null, 2)}\n`);
  } finally {
    await isolated.cleanup();
  }
}

await main();
