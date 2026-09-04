import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { waitFor } from './harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/production-command-approval-dom/', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const outputLimit = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('production command approval DOM E2E currently runs on macOS');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-outputLimit);
}

function canListen(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort() {
  for (let port = 15373; port < 15473; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error('没有可供审批 DOM fixture 使用的本机端口');
}

function startProcess(file, args, { cwd = repositoryRoot, env = process.env, label } = {}) {
  const child = spawn(file, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on('data', chunk => {
    stderr = appendBounded(stderr, chunk);
  });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    closed,
    label: label ?? file,
    readOutput: () => ({ stdout, stderr }),
  };
}

async function stopProcess(started, signal = 'SIGTERM') {
  if (started.child.exitCode !== null || started.child.signalCode !== null) return;
  try {
    process.kill(-started.child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const exited = await Promise.race([
    started.closed.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (exited) return;
  try {
    process.kill(-started.child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  await started.closed;
}

async function runChecked(file, args, { timeoutMs = 120_000 } = {}) {
  const started = startProcess(file, args);
  let timeout;
  const outcome = await Promise.race([
    started.closed,
    new Promise(resolve => {
      timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]);
  clearTimeout(timeout);
  if (outcome.timedOut) {
    await stopProcess(started, 'SIGKILL');
    throw new Error(`${file} exceeded ${timeoutMs}ms`);
  }
  if (outcome.code !== 0) {
    const output = started.readOutput();
    throw new Error(
      `${file} failed: code=${outcome.code} signal=${outcome.signal ?? 'none'} ` +
        `stderr=${output.stderr} stdout=${output.stdout}`
    );
  }
}

function probeHttp(url) {
  return new Promise(resolve => {
    const request = http.get(url, response => {
      response.resume();
      resolve(response.statusCode && response.statusCode < 500 ? true : undefined);
    });
    request.setTimeout(1_000, () => request.destroy());
    request.once('error', () => resolve(undefined));
  });
}

function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function readJsonIfPublished(resultPath) {
  try {
    return JSON.parse(await readFile(resultPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function waitForResultOrEarlyExit(started, resultPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readJsonIfPublished(resultPath);
    if (result !== undefined) return result;
    if (started.child.exitCode !== null || started.child.signalCode !== null) {
      const output = started.readOutput();
      throw new Error(
        `${started.label} exited before publishing result: ` +
          `code=${started.child.exitCode} signal=${started.child.signalCode ?? 'none'} ` +
          `stderr=${output.stderr} stdout=${output.stdout}`
      );
    }
    await Promise.race([started.closed, new Promise(resolve => setTimeout(resolve, 25))]);
  }
  throw new Error(`${started.label} did not publish result within ${timeoutMs}ms`);
}

async function verifyProcessGroupEmptyOrCleanup(processGroupId) {
  try {
    await waitFor(
      'Electron、Utility 与命令 helper 的独立进程组归零',
      () => Promise.resolve(isProcessGroupAlive(processGroupId) ? undefined : true),
      10_000
    );
  } catch (error) {
    try {
      process.kill(-processGroupId, 'SIGKILL');
    } catch (killError) {
      if (killError?.code !== 'ESRCH') throw killError;
    }
    await waitFor(
      '泄漏进程组强制收尾',
      () => Promise.resolve(isProcessGroupAlive(processGroupId) ? undefined : true),
      5_000
    );
    throw new Error('Electron 退出后仍有本轮 Utility 或命令 helper 存活', { cause: error });
  }
}

async function main() {
  const isolated = await createIsolatedRunRoot();
  let vite;
  let electron;
  let electronProcessGroupId;
  try {
    const projectRoot = path.join(isolated.path, 'electron-project');
    const resultPath = path.join(isolated.path, 'result.json');
    const builtPreloadPath = path.join(repositoryRoot, 'dist/main/preload.js');
    const preloadPath = path.join(projectRoot, 'preload.cjs');
    const runnerPath = path.join(
      repositoryRoot,
      'dist/main/commands/commandRunnerUtilityProcess.cjs'
    );
    await mkdir(projectRoot, { recursive: true });
    await runChecked('pnpm', ['run', 'build:schemas']);
    await runChecked('pnpm', ['run', 'build:preload']);
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
      '--external:@node-rs/jieba',
      '--alias:@plugin/backend=./src/plugin-sdk/backend',
      `--outfile=${path.join(projectRoot, 'main.cjs')}`,
    ]);
    await writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'linnya-production-command-approval-dom-e2e',
        version: '1.0.0',
        private: true,
        main: 'main.cjs',
      })
    );
    // 正式构建产物是 CommonJS；独立 fixture 位于 type=module 仓库之外时仍用 .cjs
    // 明确其模块身份，等价于安装包中的 CommonJS preload 上下文。
    await copyFile(builtPreloadPath, preloadPath);
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

    const vitePort = await findAvailablePort();
    const rendererUrl = `http://127.0.0.1:${vitePort}/`;
    vite = startProcess(
      'pnpm',
      ['exec', 'vite', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
      { label: 'vite' }
    );
    await waitFor('审批 DOM Vite 服务', () => probeHttp(rendererUrl), 30_000);

    const electronBinary = path.join(
      repositoryRoot,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    );
    electron = startProcess(electronBinary, [projectRoot, '--no-error-dialogs'], {
      label: 'electron',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NODE_PATH: path.join(repositoryRoot, 'node_modules'),
        LINNYA_COMMAND_APPROVAL_DOM_RESULT_PATH: resultPath,
        LINNYA_COMMAND_APPROVAL_DOM_RUN_ROOT: isolated.path,
        LINNYA_COMMAND_APPROVAL_DOM_RENDERER_URL: rendererUrl,
        LINNYA_COMMAND_APPROVAL_DOM_PRELOAD_PATH: preloadPath,
        LINNYA_COMMAND_APPROVAL_DOM_RUNNER_PATH: runnerPath,
      },
    });
    electronProcessGroupId = electron.child.pid;

    const result = await waitForResultOrEarlyExit(electron, resultPath, 90_000);
    const exit = await electron.closed;
    const electronOutput = electron.readOutput();
    assert.equal(exit.code, 0, electronOutput.stderr || JSON.stringify(result));
    assert.equal(result.success, true, result.error);
    assert.equal(result.deny.code, 'approval_denied');
    assert.equal(result.allowOnce.secondRequestedApproval, true);
    assert.equal(result.allowForConversation.secondExecutedWithoutDialog, true);
    assert.equal(result.allowForConversation.rememberedRows, 1);
    assert.equal(result.reload.oldTicketStatus, 'invalid_page');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await Promise.all([
      electron ? stopProcess(electron, 'SIGKILL') : undefined,
      vite ? stopProcess(vite) : undefined,
    ]);
    try {
      if (electronProcessGroupId !== undefined) {
        await verifyProcessGroupEmptyOrCleanup(electronProcessGroupId);
      }
    } finally {
      await isolated.cleanup();
    }
  }
}

await main();
