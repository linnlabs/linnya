import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from '../shell-tool/harness/isolatedRunRoot.mjs';
import { expectedElectronVersion } from '../shell-tool/harness/electronRuntimeIdentity.mjs';
import { waitFor } from '../shell-tool/harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/packaged-ai-sdk/', import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const fuseCliPath = path.join(repositoryRoot, 'node_modules/@electron/fuses/dist/bin.js');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('packaged AI SDK E2E 只在当前 macOS arm64 开发平台运行。');
}

function runProcess(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 120_000);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
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
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} `
        + `stderr=${result.stderr} stdout=${result.stdout}`,
    );
  }
  return result;
}

async function waitForResult(resultPath, child) {
  return waitFor('packaged AI SDK result', async () => {
    try {
      return JSON.parse(await readFile(resultPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error('packaged AI SDK fixture 在发布结果前退出。');
        }
        return undefined;
      }
      throw error;
    }
  }, 30_000);
}

const isolatedRoot = await createIsolatedRunRoot();
try {
  const projectDirectory = path.join(isolatedRoot.path, 'project');
  const outputDirectory = path.join(isolatedRoot.path, 'output');
  const resultPath = path.join(isolatedRoot.path, 'result.json');
  await mkdir(projectDirectory, { recursive: true });
  await cp(path.join(fixtureDirectory, 'package.json'), path.join(projectDirectory, 'package.json'));
  await runChecked(process.execPath, [
    'scripts/build/run-esbuild.mjs',
    path.join(fixtureDirectory, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${path.join(projectDirectory, 'main.cjs')}`,
    '--external:electron',
  ]);
  await runChecked('pnpm', [
    'exec',
    'electron-builder',
    '--projectDir',
    projectDirectory,
    '--dir',
    '--mac',
    '--arm64',
    `--config.directories.output=${outputDirectory}`,
    `--config.electronVersion=${expectedElectronVersion}`,
  ]);

  const appPath = path.join(outputDirectory, 'mac-arm64/Linnya AI SDK Validation.app');
  const executablePath = path.join(appPath, 'Contents/MacOS/Linnya AI SDK Validation');
  const fuse = await runChecked(process.execPath, [fuseCliPath, 'read', '--app', appPath]);
  assert.match(fuse.stdout, /RunAsNode is Disabled/u);

  const child = spawn(executablePath, [], {
    env: { ...process.env, LINNYA_AI_SDK_PACKAGED_RESULT_PATH: resultPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  // close 可能紧跟 result rename 发生；必须在等待结果文件前订阅，避免漏掉一次性事件。
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const result = await waitForResult(resultPath, child);
  const exit = await exitPromise;

  assert.equal(exit.code, 0, stderr);
  assert.equal(result.success, true);
  assert.equal(result.packaged, true);
  assert.equal(result.electron, expectedElectronVersion);
  assert.equal(result.platform, 'darwin');
  assert.equal(result.architecture, 'arm64');
  assert.equal(result.requestCount, 1);
  assert.equal(result.authorization, 'Bearer packaged-secret');
  assert.deepEqual(result.events, [
    { type: 'start', model_id: 'packaged-model', attempt_id: 'attempt-packaged' },
    { type: 'answer_delta', text: 'packaged answer' },
    { type: 'assistant_part_end', index: 0, part: { type: 'text', text: 'packaged answer' } },
    {
      type: 'usage',
      usage: {
        inputTokens: 9,
        outputTokens: 3,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        source: 'provider-response-usage',
        confidence: 'actual',
        rawUsage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      },
    },
    { type: 'finish', reason: 'stop' },
  ]);
  console.log(JSON.stringify({ success: true, packaged: true, electron: result.electron }));
} finally {
  await isolatedRoot.cleanup();
}
