import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/app-update-handoff/', import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');

function runProcess(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, options);
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-128 * 1024); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr });
    });
  });
}

async function main() {
  const isolated = await createIsolatedRunRoot('app-update-handoff');
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const distMainRoot = path.join(projectRoot, 'dist', 'main');
    const distRendererRoot = path.join(projectRoot, 'dist', 'renderer');
    const resultPath = path.join(isolated.path, 'result.json');
    await mkdir(distMainRoot, { recursive: true });
    await mkdir(distRendererRoot, { recursive: true });
    const build = await runProcess('pnpm', [
      'exec',
      'esbuild',
      path.join(fixtureDirectory, 'main.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=node20',
      '--external:electron',
      `--outfile=${path.join(distMainRoot, 'main.cjs')}`,
    ], { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'pipe'] });
    assert.deepEqual(
      { code: build.code, signal: build.signal },
      { code: 0, signal: null },
      build.stderr,
    );
    await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
      name: 'linnya-app-update-handoff-e2e',
      version: '1.0.0',
      private: true,
      main: 'dist/main/main.cjs',
    }), 'utf8');
    await writeFile(path.join(distMainRoot, 'preload.js'), '', 'utf8');
    await writeFile(path.join(distRendererRoot, 'index.html'), '<!doctype html><title>Linnya updater handoff</title>', 'utf8');
    await symlink(path.join(repositoryRoot, 'node_modules'), path.join(projectRoot, 'node_modules'));

    const electronBinary = process.platform === 'darwin'
      ? path.join(repositoryRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
      : path.join(repositoryRoot, 'node_modules/electron/dist/electron');
    const run = await runProcess(electronBinary, [projectRoot, '--no-error-dialogs'], {
      cwd: repositoryRoot,
      env: { ...process.env, LINNYA_UPDATE_HANDOFF_RESULT_PATH: resultPath },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    assert.deepEqual(
      { code: run.code, signal: run.signal },
      { code: 0, signal: null },
      run.stderr,
    );
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.equal(result.success, true);
    assert.equal(result.handoffPhase, 'update_handoff');
    assert.deepEqual(result.events, [
      'prepare:install_update',
      'window_close_committed',
      'update_committed',
      'shutdown_stages',
      'log_drain',
      'update_handoff',
      'before-quit:update_handoff',
      'window_close_prevented:false',
      'window_closed',
      'will-quit:update_handoff',
    ]);

    process.stdout.write(`${JSON.stringify({
      ...result,
      electronExitCode: run.code,
      electronExitSignal: run.signal,
      updaterQuitWasNotPrevented: true,
    }, null, 2)}\n`);
  } finally {
    await isolated.cleanup();
  }
}

await main();
