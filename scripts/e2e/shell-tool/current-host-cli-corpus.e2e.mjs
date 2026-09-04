import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { waitFor } from './harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/current-host-cli-corpus/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const OUTPUT_LIMIT = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('current-host CLI production corpus controller currently runs on macOS');
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

async function main() {
  const isolated = await createIsolatedRunRoot('current-host-cli-corpus 中文');
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const runnerRoot = path.join(isolated.path, 'runner');
    const resultPath = path.join(isolated.path, 'result.json');
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      mkdir(runnerRoot, { recursive: true }),
    ]);
    await runChecked('pnpm', ['run', 'build:schemas']);
    await runChecked('pnpm', ['run', 'build:command-runner']);
    await runChecked('pnpm', ['run', 'guard:better:electron']);
    await copyFile(
      path.join(repositoryRoot, 'dist/main/commands/commandRunnerUtilityProcess.cjs'),
      path.join(runnerRoot, 'commandRunnerUtilityProcess.cjs')
    );
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
        name: 'linnya-current-host-cli-corpus-e2e',
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
    await symlink(
      path.join(repositoryRoot, 'node_modules'),
      path.join(projectRoot, 'node_modules')
    );

    const electronBinary = path.join(
      repositoryRoot,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    );
    const child = spawn(electronBinary, [projectRoot, '--no-error-dialogs'], {
      cwd: repositoryRoot,
      env: {
        HOME: process.env.HOME,
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        PATH: '/bin:/usr/sbin:/sbin',
        NODE_PATH: path.join(repositoryRoot, 'node_modules'),
        LINNYA_HOST_CLI_CORPUS_RESULT_PATH: resultPath,
        LINNYA_HOST_CLI_CORPUS_RUN_ROOT: isolated.path,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr = appendBounded(stderr, chunk);
    });
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    let completed = false;
    try {
      const result = await waitFor(
        'current-host CLI corpus result',
        async () => {
          try {
            return JSON.parse(await readFile(resultPath, 'utf8'));
          } catch (error) {
            if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
            throw error;
          }
        },
        120_000
      );
      const exit = await closed;
      assert.equal(exit.code, 0, stderr || JSON.stringify(result));
      assert.equal(result.success, true, result.error);
      assert.equal(result.utilityAndSrt, true);
      assert.equal(result.environmentProbe.status, 'succeeded');
      assert.equal(result.environmentProbe.source, 'macos_login_shell');
      assert.equal(Number.isInteger(result.environmentProbe.variableCount), true);
      assert(result.environmentProbe.variableCount > 0);
      assert.deepEqual(result.pc52InputBoundary, {
        acceptedCharacters: 12_000,
        acceptedExitCode: 0,
        invalidCasesRejectedBeforeAudit: 2,
        publicRejectionCode: 'invalid_arguments',
      });
      assert.deepEqual(
        result.cases.map(item => [item.id, item.exitCode]),
        [
          ['zsh', 23],
          ['python3', 31],
          ['node', 41],
          ['git', 0],
          ['hermes', 0],
          ['ffmpeg-missing', 127],
          ['pandoc-missing', 127],
        ]
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      completed = true;
    } finally {
      if (!completed && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await closed.catch(() => undefined);
      }
    }
  } finally {
    await isolated.cleanup();
  }
}

await main();
