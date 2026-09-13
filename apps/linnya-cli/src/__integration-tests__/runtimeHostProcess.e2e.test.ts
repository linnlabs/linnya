import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const cliEntry = path.join(repoRoot, 'apps/linnya-cli/bin/linnya.cjs');
const runtimeSuite = process.env.LINNYA_CLI_RUNTIME_E2E === '1' ? describe : describe.skip;
const temporaryRoots: string[] = [];
const liveRuntimes: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  await Promise.all(liveRuntimes.splice(0).map(async child => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await waitForClose(child).catch(() => undefined);
  }));
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

runtimeSuite('built CLI Runtime -> fixed Node App Server', () => {
  it('冷启动、并行运行、拒绝第二 owner，并在重启后保留历史', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-runtime-e2e-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'connection.json');
    const modelCatalog = path.join(root, 'default-models.json');
    await fs.mkdir(workspace, { recursive: true });
    await writeFastMockModelCatalog(modelCatalog);
    const environment = createRuntimeEnvironment({ connectionFile, modelCatalog });

    const first = await startRuntime({ workspace, environment });
    expect(await fs.stat(connectionFile)).toMatchObject({ mode: expect.any(Number) });
    expect(first.ready.runtime.database_ready).toBe(true);
    expect(first.stderr).not.toContain('Electron');

    const doctor = await runCli(['doctor'], environment);
    expect(doctor.code).toBe(0);
    expect(parseJson(doctor.stdout)).toMatchObject({
      ok: true,
      app: { version: '0.0.38' },
    });

    const [sendA, sendB] = await Promise.all([
      runCli(['send', 'parallel-a', '--agent', 'default', '--model', 'mock-debug-chat'], environment),
      runCli(['send', 'parallel-b', '--agent', 'writing', '--model', 'mock-debug-chat'], environment),
    ]);
    const receiptA = readReceipt(sendA);
    const receiptB = readReceipt(sendB);
    expect(receiptA.conversation_id).not.toBe(receiptB.conversation_id);

    const [statusA, statusB] = await Promise.all([
      runCli([
        'status', receiptA.conversation_id, '--run', receiptA.run_id,
        '--watch', '--interval', '250', '--timeout', '20000',
      ], environment),
      runCli([
        'status', receiptB.conversation_id, '--run', receiptB.run_id,
        '--watch', '--interval', '250', '--timeout', '20000',
      ], environment),
    ]);
    expect(statusA.code).toBe(0);
    expect(statusB.code).toBe(0);
    expect(readLastJsonLine(statusA.stdout)).toMatchObject({ snapshot: { status: 'completed' } });
    expect(readLastJsonLine(statusB.stdout)).toMatchObject({ snapshot: { status: 'completed' } });

    const contender = await runCli([
      'runtime', 'start', '--workspace', workspace,
      '--qdrant-port', String(await reservePort()),
    ], { ...environment, LINNYA_CLI_CONNECTION_FILE: path.join(root, 'contender.json') });
    expect(contender.code).toBe(6);
    expect(readJsonLines(contender.stderr).find(hasErrorField)).toMatchObject({
      error: { code: 'conversation_busy' },
    });

    first.child.kill('SIGINT');
    expect(await waitForClose(first.child)).toBe(0);
    removeLiveRuntime(first.child);
    await expect(fs.stat(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(isProcessAlive(first.ready.runtime.pid)).toBe(false);

    const restarted = await startRuntime({ workspace, environment });
    const history = await runCli(['list', '--limit', '10'], environment);
    expect(history.code).toBe(0);
    const conversationIds = readConversationIds(history.stdout);
    expect(conversationIds).toEqual(expect.arrayContaining([
      receiptA.conversation_id,
      receiptB.conversation_id,
    ]));
    restarted.child.kill('SIGTERM');
    expect(await waitForClose(restarted.child)).toBe(0);
    removeLiveRuntime(restarted.child);
    await expect(fs.stat(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('launcher 被 SIGKILL 后 App Server 通过 pipe EOF 收口，并允许同一 Workspace 重启', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-runtime-crash-e2e-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'connection.json');
    const modelCatalog = path.join(root, 'default-models.json');
    await fs.mkdir(workspace, { recursive: true });
    await writeFastMockModelCatalog(modelCatalog);
    const environment = createRuntimeEnvironment({ connectionFile, modelCatalog });

    const crashed = await startRuntime({ workspace, environment });
    const previousDescriptor = await readConnectionIdentity(connectionFile);
    crashed.child.kill('SIGKILL');
    await waitForClose(crashed.child);
    removeLiveRuntime(crashed.child);
    // orphan 在部分平台会短暂保留 zombie PID，descriptor 也可能在异常退出竞态中残留。
    // 真正的恢复门禁是旧 API 已停且 Workspace 排他 owner 已释放。
    await waitFor(() => isWorkspaceOwnershipAvailable(workspace), 30_000);

    const restarted = await startRuntime({ workspace, environment });
    const replacementDescriptor = await readConnectionIdentity(connectionFile);
    expect(replacementDescriptor.pid).toBe(restarted.ready.runtime.pid);
    expect(replacementDescriptor.appInstanceId).not.toBe(previousDescriptor.appInstanceId);
    restarted.child.kill('SIGTERM');
    expect(await waitForClose(restarted.child)).toBe(0);
    removeLiveRuntime(restarted.child);
  }, 45_000);
});

async function startRuntime(input: {
  readonly workspace: string;
  readonly environment: NodeJS.ProcessEnv;
}): Promise<{
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: { readonly runtime: { readonly pid: number; readonly database_ready: boolean } };
  readonly stderr: string;
}> {
  const child = spawn(process.execPath, [
    cliEntry,
    'runtime', 'start',
    '--workspace', input.workspace,
    '--qdrant-port', String(await reservePort()),
  ], {
    cwd: repoRoot,
    env: input.environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  liveRuntimes.push(child);
  child.stdin.end();
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr = `${stderr}${String(chunk)}`.slice(-200_000);
  });
  const ready = await readFirstJsonLine(child, 20_000);
  if (!isRuntimeReady(ready)) {
    throw new Error(`CLI Runtime 返回无效 ready frame: ${JSON.stringify(ready)}\n${stderr}`);
  }
  return { child, ready, stderr };
}

function runCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: repoRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += String(chunk); });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

function readFirstJsonLine(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('等待 CLI Runtime ready 超时'));
    }, timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      buffer += String(chunk);
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      cleanup();
      try {
        resolve(JSON.parse(buffer.slice(0, lineEnd)));
      } catch (error: unknown) {
        reject(error);
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('CLI Runtime 在 ready 前退出'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('close', onClose);
    };
    child.stdout.on('data', onData);
    child.once('close', onClose);
  });
}

function waitForClose(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('等待 CLI Runtime 退出超时')), 15_000);
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

async function writeFastMockModelCatalog(target: string): Promise<void> {
  const source = await fs.readFile(path.join(
    repoRoot,
    'src/domains/model-catalog/features/default-catalog/assets/default_models.json',
  ), 'utf8');
  const original = 'mock://local?script=markdown_kitchen_sink';
  const replacement = 'mock://local?preset=content&delay_ms=0&chunk_size=200';
  if (!source.includes(original)) throw new Error('默认 mock 模型测试入口不存在');
  await fs.writeFile(target, source.replace(original, replacement));
}

function createRuntimeEnvironment(input: {
  readonly connectionFile: string;
  readonly modelCatalog: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LINNYA_CLI_CONNECTION_FILE: input.connectionFile,
    MODEL_REGISTRY_DEFAULTS_PATH: input.modelCatalog,
    LINNYA_PLUGIN_DIRECT_DIRS: undefined,
    LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: undefined,
  };
}

function isRuntimeReady(value: unknown): value is {
  readonly runtime: { readonly pid: number; readonly database_ready: boolean };
} {
  if (typeof value !== 'object' || value === null) return false;
  const runtime = Reflect.get(value, 'runtime');
  return typeof runtime === 'object'
    && runtime !== null
    && typeof Reflect.get(runtime, 'pid') === 'number'
    && Reflect.get(runtime, 'database_ready') === true;
}

function parseJson(text: string): unknown {
  return JSON.parse(text.trim());
}

function readReceipt(result: { readonly code: number | null; readonly stdout: string; readonly stderr: string }): {
  readonly conversation_id: string;
  readonly run_id: string;
} {
  if (result.code !== 0) throw new Error(`send 失败: ${result.stderr}`);
  const value = parseJson(result.stdout);
  if (typeof value !== 'object' || value === null) throw new Error('send 回执不是对象');
  const receipt = Reflect.get(value, 'receipt');
  if (typeof receipt !== 'object' || receipt === null) throw new Error('send 回执缺少 receipt');
  const conversationId = Reflect.get(receipt, 'conversation_id');
  const runId = Reflect.get(receipt, 'run_id');
  if (typeof conversationId !== 'string' || typeof runId !== 'string') {
    throw new Error('send 回执缺少 Conversation/Run identity');
  }
  return { conversation_id: conversationId, run_id: runId };
}

function readLastJsonLine(text: string): unknown {
  const lines = text.trim().split('\n');
  return JSON.parse(lines.at(-1) ?? 'null');
}

function readJsonLines(text: string): readonly unknown[] {
  return text.split('\n').flatMap(line => {
    try {
      const value: unknown = JSON.parse(line);
      return [value];
    } catch {
      return [];
    }
  });
}

function hasErrorField(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Reflect.has(value, 'error');
}

function readConversationIds(text: string): readonly string[] {
  const value = parseJson(text);
  if (typeof value !== 'object' || value === null) throw new Error('history 不是对象');
  const conversations = Reflect.get(value, 'conversations');
  if (!Array.isArray(conversations)) throw new Error('history 缺少 conversations');
  return conversations.flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const id = Reflect.get(item, 'conversation_id');
    return typeof id === 'string' ? [id] : [];
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeLiveRuntime(child: ChildProcessWithoutNullStreams): void {
  const index = liveRuntimes.indexOf(child);
  if (index >= 0) liveRuntimes.splice(index, 1);
}

async function readConnectionIdentity(target: string): Promise<{
  readonly pid: number;
  readonly appInstanceId: string;
}> {
  const value: unknown = JSON.parse(await fs.readFile(target, 'utf8'));
  if (typeof value !== 'object' || value === null) throw new Error('连接描述不是对象');
  const pid = Reflect.get(value, 'pid');
  const appInstanceId = Reflect.get(value, 'app_instance_id');
  if (typeof pid !== 'number' || typeof appInstanceId !== 'string') {
    throw new Error('连接描述缺少 Runtime identity');
  }
  return { pid, appInstanceId };
}

function isWorkspaceOwnershipAvailable(workspace: string): boolean {
  const connection = new Database(path.join(workspace, '.runtime-owner.lock'), { timeout: 0 });
  try {
    connection.exec('BEGIN EXCLUSIVE');
    connection.exec('ROLLBACK');
    return true;
  } catch {
    return false;
  } finally {
    connection.close();
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error(`等待 Runtime 收口超时: ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
