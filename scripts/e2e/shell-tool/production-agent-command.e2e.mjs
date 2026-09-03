import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { waitFor } from './harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/production-agent-command/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runnerRoot = path.join(repositoryRoot, 'dist/main/commands');
const OUTPUT_LIMIT = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('production Agent command development E2E currently runs on macOS');
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
  const isolated = await createIsolatedRunRoot('production-agent-command');
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const resultPath = path.join(isolated.path, 'result.json');
    await mkdir(projectRoot, { recursive: true });
    await runChecked('pnpm', ['run', 'build:schemas']);
    await runChecked('pnpm', ['run', 'build:command-runner']);
    await runChecked('pnpm', ['run', 'guard:better:electron']);
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
        name: 'linnya-production-agent-command-e2e',
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
    const child = spawn(electronBinary, [projectRoot, '--no-error-dialogs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_PATH: path.join(repositoryRoot, 'node_modules'),
        LINNYA_AGENT_COMMAND_RESULT_PATH: resultPath,
        LINNYA_AGENT_COMMAND_RUN_ROOT: isolated.path,
        LINNYA_AGENT_COMMAND_RUNNER_ROOT: runnerRoot,
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
        'production Agent command result',
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
      const exit = await closed;
      assert.equal(exit.code, 0, stderr || JSON.stringify(result));
      assert.equal(result.success, true, result.error);
      assert.equal(result.commandCardState, 'completed');
      assert.equal(result.missingWorkingDirectoriesCreated, false);
      assert.equal(result.rejectedCommandsExecuted, false);
      assert.deepEqual(result.rejectedToolCallIds, [
        'call-agent-command-missing-git',
        'call-agent-command-missing-agents',
      ]);
      assert.deepEqual(result.commandAuditActions, [
        'command.proposal.created',
        'command.authorization.settled',
        'command.execution.started',
        'command.execution.terminal',
      ]);
      assert(result.artifactFiles.length >= 2);
      assert(result.toolOutputFiles.length >= 2);
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
