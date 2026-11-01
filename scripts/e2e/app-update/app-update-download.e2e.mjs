import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from '../shell-tool/harness/isolatedRunRoot.mjs';

// 真实 Electron + electron-updater 下载链路；更新源是 fixture 自己起的本机 HTTP 服务。
const fixtureDirectory = fileURLToPath(new URL('./fixtures/app-update-download/', import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');

function runProcess(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, options);
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-128 * 1024); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr });
    });
  });
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('当前下载链路 gate 使用 macOS 的 latest-mac.yml');
  const isolated = await createIsolatedRunRoot();
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const distMainRoot = path.join(projectRoot, 'dist', 'main');
    const workRoot = path.join(isolated.path, 'work');
    const resultPath = path.join(isolated.path, 'result.json');
    await mkdir(distMainRoot, { recursive: true });
    await mkdir(workRoot, { recursive: true });
    const build = await runProcess('pnpm', [
      'exec', 'esbuild', path.join(fixtureDirectory, 'main.ts'),
      '--bundle', '--platform=node', '--format=cjs', '--target=node20',
      '--external:electron', `--outfile=${path.join(distMainRoot, 'main.cjs')}`,
    ], { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'pipe'] });
    assert.deepEqual({ code: build.code, signal: build.signal }, { code: 0, signal: null }, build.stderr);
    await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
      name: 'linnya-app-update-download-e2e',
      version: '0.1.0',
      private: true,
      main: 'dist/main/main.cjs',
    }), 'utf8');
    await symlink(path.join(repositoryRoot, 'node_modules'), path.join(projectRoot, 'node_modules'));

    const electronBinary = path.join(repositoryRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const run = await runProcess(electronBinary, [projectRoot, '--no-error-dialogs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        LINNYA_UPDATE_DOWNLOAD_RESULT_PATH: resultPath,
        LINNYA_UPDATE_DOWNLOAD_WORK_ROOT: workRoot,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.equal(result.success, true, `${result.error ?? ''}\n${run.stderr}`);
    assert.deepEqual(result.sameVersion, { kind: 'up-to-date' });
    assert.equal(result.sameVersionStatus, 'idle');
    assert.deepEqual(result.available, { kind: 'available', version: '0.2.0' });
    assert.equal(result.pausedFailure, 'network');
    assert.deepEqual(result.dropSequence, ['downloading', 'paused', 'downloading', 'ready']);
    assert.equal(result.progressPublished, true);
    assert.equal(result.pendingInstallAfterReady, '0.2.0');
    assert.deepEqual(result.corruptState, { status: 'failed', failure: { kind: 'integrity', retryAt: null } });
    assert.equal(result.cancelState, 'available');
    process.stdout.write(`${JSON.stringify({ ...result, electronExitCode: run.code }, null, 2)}\n`);
  } finally {
    await isolated.cleanup();
  }
}

await main();
