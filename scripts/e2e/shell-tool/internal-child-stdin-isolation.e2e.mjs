import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { waitFor } from './harness/processObservation.mjs';

if (process.platform !== 'darwin') {
  throw new Error('internal child stdin isolation E2E currently runs on macOS');
}

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/internal-child-stdin-isolation/', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const SENTINEL = 'USER_KEYSTROKE_MUST_NOT_REACH_INTERNAL_CHILD';

async function runChecked(file, args) {
  const child = spawn(file, args, {
    cwd: repositoryRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(exit, { code: 0, signal: null }, Buffer.concat(stderr).toString('utf8'));
}

const isolated = await createIsolatedRunRoot('internal-child-stdin-isolation');
let electron;
try {
  const projectRoot = path.join(isolated.path, 'electron-project');
  const resultPath = path.join(isolated.path, 'result.json');
  const utilityPath = path.join(fixtureDirectory, 'read-stdin.cjs');
  await mkdir(projectRoot, { recursive: true });
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(fixtureDirectory, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:electron',
    `--outfile=${path.join(projectRoot, 'main.cjs')}`,
  ]);
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'linnya-internal-child-stdin-isolation-e2e',
    version: '1.0.0',
    private: true,
    main: 'main.cjs',
  }), 'utf8');
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(projectRoot, 'node_modules'));

  const electronBinary = path.join(
    repositoryRoot,
    'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  );
  electron = spawn(electronBinary, [projectRoot, '--no-error-dialogs'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_PATH: path.join(repositoryRoot, 'node_modules'),
      LINNYA_INTERNAL_STDIN_RESULT_PATH: resultPath,
      LINNYA_INTERNAL_STDIN_UTILITY_PATH: utilityPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  electron.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
  electron.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
  electron.stdin.write(`${SENTINEL}\n`);

  const result = await waitFor('internal child stdin isolation result', async () => {
    try {
      return JSON.parse(await readFile(resultPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }, 15_000);
  const exit = await new Promise((resolve, reject) => {
    electron.once('error', reject);
    electron.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(
    exit,
    { code: 0, signal: null },
    `${Buffer.concat(stderr).toString('utf8')} ${Buffer.concat(stdout).toString('utf8')}`,
  );
  assert.equal(result.success, true, result.error);
  const expectedObservation = {
    bytesRead: 0,
    errorCode: null,
    stdinIsTTY: false,
    observedText: '',
  };
  assert.deepEqual(result.sandboxObservation, expectedObservation);
  assert.deepEqual(result.commandObservation, expectedObservation);
  assert(!JSON.stringify(result).includes(SENTINEL));

  process.stdout.write(`${JSON.stringify({
    success: true,
    platform: process.platform,
    architecture: process.arch,
    outerStdinStayedOpen: true,
    sandboxUtilityBytesRead: result.sandboxObservation.bytesRead,
    commandUtilityBytesRead: result.commandObservation.bytesRead,
    utilityObservedSentinel: false,
  }, null, 2)}\n`);
} finally {
  if (electron && electron.exitCode === null) electron.kill('SIGKILL');
  await isolated.cleanup();
}
