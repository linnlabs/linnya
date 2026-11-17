import { mkdtemp, mkdir, rm, symlink, access, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import type { PluginWorkerQueue } from '@linnya/plugin-host-contract/backend/workerQueue';
import { registeredBackendPluginDirectories } from '../../../plugin-registry/registeredPluginDirectories';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { createHostPluginWorkerQueue } from '../orchestration/createHostPluginWorkerQueue';
import { pluginWorkerSdkAliases } from '../../../../../../scripts/build/plugin-worker-sdk.mjs';

interface Job {
  taskId: string;
  mode: 'database' | 'inference' | 'crash';
  modelId: string;
  __linnyaWorkerHost?: unknown;
}
let root: string;
let artifact: string;
let nextDatabase = 0;
const queues: PluginWorkerQueue<Job>[] = [];
const databases: Database.Database[] = [];

function inference(): PluginInferencePort {
  return {
    embedding: {
      embed: vi.fn(async request => ({
        vectors: request.values.map(() => [1, 2]),
        spaceId: 'fixture',
      })),
    },
    textGeneration: {
      generate: vi.fn(
        async (): Promise<
          Awaited<ReturnType<PluginInferencePort['textGeneration']['generate']>>
        > => ({ text: '', reasoning: '', finishReason: 'stop' })
      ),
    },
    reranking: { rerank: vi.fn(async () => ({ ranking: [] })) },
    documentOcr: {
      resolveModelProfile: vi.fn(async () => undefined),
      recognizeDocument: vi.fn(async () => ({ pages: [] })),
    },
  };
}

function setup(options: { version?: number; port?: PluginInferencePort; entry?: string } = {}) {
  const db = new Database(path.join(root, `data-${nextDatabase++}.sqlite`));
  databases.push(db);
  db.pragma(`user_version = ${options.version ?? 7}`);
  db.exec('CREATE TABLE plugin_rows(id TEXT PRIMARY KEY)');
  registeredBackendPluginDirectories.set('worker-fixture', artifact);
  setPluginRuntimeStateForTests({ enabledPluginIds: ['worker-fixture'] });
  const environment = {
    PATH: process.env.PATH,
    OPENAI_API_KEY: 'fixture-secret',
    NODE_OPTIONS: '--invalid-for-worker',
  };
  const queue = createHostPluginWorkerQueue<Job>(
    {
      pluginId: 'worker-fixture',
      workerEntry: options.entry ?? 'dist/managed.worker.cjs',
      maxConcurrency: 1,
      inferenceAdmission: job => ({
        operations: ['embed', 'ocr'],
        modelIds: [job.modelId],
        inputFiles: [],
      }),
    },
    {
      database: { path: db.name, schemaVersion: 7 },
      inference: options.port ?? inference(),
      environment,
    }
  );
  queues.push(queue);
  return { queue, db, environment };
}

function observe(queue: PluginWorkerQueue<Job>) {
  const progress: unknown[] = [];
  let result: unknown;
  let failure: string | undefined;
  let finish: () => void = () => {};
  const settled = new Promise<void>(resolve => {
    finish = resolve;
  });
  const dispose = queue.subscribe({
    progress: event => progress.push(event),
    completed: event => {
      result = event.result;
    },
    failed: event => {
      failure = event.error;
    },
    settled: () => finish(),
  });
  return {
    progress,
    settled,
    dispose,
    get result() {
      return result;
    },
    get failure() {
      return failure;
    },
  };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-worker-'));
  artifact = path.join(root, 'artifact');
  await mkdir(path.join(artifact, 'dist'), { recursive: true });
  const require = createRequire(import.meta.url);
  const nativeDatabaseModule = require.resolve('better-sqlite3');
  const output = await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/managed.worker.ts', import.meta.url))],
    outfile: path.join(artifact, 'dist/managed.worker.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    metafile: true,
    logLevel: 'silent',
    tsconfig: path.resolve('tsconfig.json'),
    // 测试 artifact 从临时目录执行，native ABI 明确使用本工作区已验收的 Host 模块。
    alias: { ...pluginWorkerSdkAliases(process.cwd()), 'better-sqlite3': nativeDatabaseModule },
    external: [nativeDatabaseModule],
  });
  expect(
    Object.keys(output.metafile.inputs).filter(file =>
      /model-catalog|credential-storage|provider-account|services\/database(?:\/|\.ts)/.test(file)
    )
  ).toEqual([]);
  expect(
    Object.values(output.metafile.outputs)
      .flatMap(value => value.imports)
      .filter(value => value.path.startsWith('@plugin/'))
  ).toEqual([]);
});

afterEach(async () => {
  await Promise.all(queues.splice(0).map(queue => queue.shutdown()));
  for (const db of databases.splice(0)) db.close();
  registeredBackendPluginDirectories.delete('worker-fixture');
  clearPluginRuntimeStateForTests();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('plugin artifact Worker runtime', () => {
  it('真实线程使用Host冻结连接并提交/回滚，保留pragma且不继承凭据环境', async () => {
    const { queue, db, environment } = setup();
    const observation = observe(queue);
    const job: Job = {
      taskId: 'stored',
      mode: 'database',
      modelId: 'embedding',
      __linnyaWorkerHost: {
        database: { path: path.join(root, 'unowned.sqlite'), schemaVersion: 1 },
      },
    };
    await queue.addTask(job);
    job.taskId = 'changed-after-enqueue';
    environment.PATH = 'changed-after-creation';
    await observation.settled;
    expect(observation.failure).toBeUndefined();
    expect(observation.result).toEqual({
      rows: [{ id: 'stored' }],
      foreignKeys: { foreign_keys: 1 },
      busyTimeout: { timeout: 5000 },
      journal: { journal_mode: 'wal' },
      hasCredential: false,
      pathAvailable: true,
      exposed: ['close', 'prepare', 'transaction'],
    });
    expect(db.prepare('SELECT id FROM plugin_rows').all()).toEqual([{ id: 'stored' }]);
    expect(observation.progress).toHaveLength(1);
    expect(queue.getTask('stored')?.data.taskId).toBe('stored');
    await expect(access(path.join(root, 'unowned.sqlite'))).rejects.toThrow();
  });

  it('schema不匹配拒绝线程写入，既有数据库不会被迁移或切换journal', async () => {
    const { queue, db } = setup({ version: 6 });
    const observation = observe(queue);
    await queue.addTask({ taskId: 'wrong-schema', mode: 'database', modelId: 'embedding' });
    await observation.settled;
    expect(observation.failure).toContain('user_version=6');
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(db.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(db.prepare('SELECT * FROM plugin_rows').all()).toEqual([]);
  });

  it('只接纳本artifact相对入口，停用/换版本/关闭后不接收新任务', async () => {
    for (const entry of [
      '../outside.cjs',
      path.join(artifact, 'dist/managed.worker.cjs'),
      'C:\\outside.cjs',
    ]) {
      expect(() => setup({ entry })).toThrow();
    }
    await symlink(path.join(artifact, 'dist/managed.worker.cjs'), path.join(root, 'other.cjs'));
    await symlink(path.join(root, 'other.cjs'), path.join(artifact, 'dist/link.cjs'));
    await copyFile(path.join(artifact, 'dist/managed.worker.cjs'), path.join(root, 'outside.cjs'));
    await symlink(path.join(root, 'outside.cjs'), path.join(artifact, 'dist/escape.cjs'));
    expect(() => setup({ entry: 'dist/escape.cjs' })).toThrow();
    // 指向同一artifact的真实路径是合法的；最终目标归属由realpath决定。
    const { queue } = setup({ entry: 'dist\\link.cjs' });
    const job: Job = { taskId: 'blocked', mode: 'database', modelId: 'embedding' };
    setPluginRuntimeStateForTests({ installedPluginIds: ['worker-fixture'] });
    await expect(queue.addTask(job)).rejects.toThrow('未启用');
    setPluginRuntimeStateForTests({ enabledPluginIds: ['worker-fixture'] });
    registeredBackendPluginDirectories.set('worker-fixture', root);
    await expect(queue.addTask(job)).rejects.toThrow('artifact 已变更');
    await queue.shutdown();
    await expect(queue.addTask(job)).rejects.toThrow('正在关闭');
    expect(() =>
      createHostPluginWorkerQueue(
        { pluginId: 'unknown', workerEntry: 'x.cjs' },
        {
          database: { path: '', schemaVersion: 7 },
          inference: inference(),
          environment: {},
        }
      )
    ).toThrow('已准入');
  });

  it('父取消真实Host推理，settled必须等Host清理完成且保持原模型快照', async () => {
    let started: () => void = () => {};
    let aborted: () => void = () => {};
    let release: () => void = () => {};
    const start = new Promise<void>(resolve => {
      started = resolve;
    });
    const abort = new Promise<void>(resolve => {
      aborted = resolve;
    });
    const cleanup = new Promise<void>(resolve => {
      release = resolve;
    });
    const port = inference();
    const embed = vi.fn(
      async (request: Parameters<PluginInferencePort['embedding']['embed']>[0]) => {
        started();
        await new Promise<void>(resolve =>
          request.signal?.addEventListener(
            'abort',
            () => {
              aborted();
              resolve();
            },
            { once: true }
          )
        );
        await cleanup;
        throw new DOMException('cancelled fixture', 'AbortError');
      }
    );
    const { queue } = setup({ port: { ...port, embedding: { embed } } });
    const observation = observe(queue);
    let settled = false;
    void observation.settled.then(() => {
      settled = true;
    });
    const job: Job = { taskId: 'cancel', mode: 'inference', modelId: 'frozen-model' };
    await queue.addTask(job);
    job.modelId = 'changed';
    await start;
    expect(embed.mock.calls[0]?.[0].modelId).toBe('frozen-model');
    await queue.cancelTask('cancel');
    await abort;
    await new Promise<void>(resolve => setImmediate(resolve));
    try {
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await observation.settled;
    expect(queue.getTask('cancel')?.state).toBe('failed');
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('线程意外退出也中止Host请求并等待清理，队列shutdown不遗留推理', async () => {
    let aborted: () => void = () => {};
    let release: () => void = () => {};
    const abort = new Promise<void>(resolve => {
      aborted = resolve;
    });
    const cleanup = new Promise<void>(resolve => {
      release = resolve;
    });
    const port = inference();
    const recognizeDocument: PluginInferencePort['documentOcr']['recognizeDocument'] =
      async request => {
        const stopped = new Promise<void>(resolve =>
          request.options?.signal?.addEventListener(
            'abort',
            () => {
              aborted();
              resolve();
            },
            { once: true }
          )
        );
        request.options?.onProgress?.({ state: 'running' });
        await stopped;
        await cleanup;
        throw new DOMException('worker exited', 'AbortError');
      };
    const { queue } = setup({
      port: { ...port, documentOcr: { ...port.documentOcr, recognizeDocument } },
    });
    const observation = observe(queue);
    let settled = false;
    void observation.settled.then(() => {
      settled = true;
    });
    await queue.addTask({ taskId: 'crashed', mode: 'crash', modelId: 'ocr' });
    await abort;
    await new Promise<void>(resolve => setImmediate(resolve));
    try {
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await observation.settled;
    expect(observation.failure).toContain('Worker意外退出');
    await queue.shutdown();
    expect(queue.listTasks()).toEqual([]);
  });
});
