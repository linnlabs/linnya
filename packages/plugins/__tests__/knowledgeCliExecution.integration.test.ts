import { mkdtemp, mkdir, readFile, rm, copyFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION } from 'src/electron-main/services/database/migrations';
import type { PluginInferencePort } from '@plugin/backend/inferenceRuntime';
import type { PluginWorkerQueueOptions } from '@plugin/backend/workerQueue';
import { createHostPluginWorkerQueue } from 'src/app-hosts/linnya/adapters/plugin-worker-queue/orchestration/createHostPluginWorkerQueue';
import { registeredBackendPluginDirectories } from 'src/app-hosts/linnya/plugin-registry/registeredPluginDirectories';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  KNOWLEDGE_BASE_SCHEMAS,
  KNOWLEDGE_GRAPH_SCHEMAS,
} from '../knowledge/src/backend/database/schemas';
import {
  createKnowledgeRuntime,
  type KnowledgeRuntime,
} from '../knowledge/src/backend/runtime/orchestration/createKnowledgeRuntime';
import { createKnowledgeCli } from '../knowledge/src/backend/cli/orchestration/createKnowledgeCli';
import { createDocument, DocumentStatus } from '../knowledge/src/backend/domain/document';
import { BlockType } from '../knowledge/src/backend/domain/block';
import { pluginWorkerSdkAliases } from '../../../scripts/build/plugin-worker-sdk.mjs';

let root: string;
let bundleRoot: string;
let database: Database.Database;
let runtime: KnowledgeRuntime;
let attempts: number;
let mode: 'once' | 'exhaust' | 'cancel';
let waitingForAbort: boolean;
let cancelledRequests: number;
let maintenanceSchedules: number;
const uiCalls: string[] = [];
const cliCalls: string[] = [];
const retryDelays: number[] = [];
const normalInference: PluginInferencePort = {
  embedding: {
    embed: async request => ({
      spaceId: 'fixture-space',
      vectors: request.values.map(() => [1, 0]),
    }),
  },
  textGeneration: { generate: async () => ({ text: '{}', reasoning: '', finishReason: 'stop' }) },
  reranking: { rerank: async () => ({ ranking: [] }) },
  documentOcr: {
    resolveModelProfile: async () => undefined,
    recognizeDocument: async () => ({ pages: [] }),
  },
};
const uiInference: PluginInferencePort = {
  ...normalInference,
  embedding: {
    embed: request => {
      uiCalls.push(request.modelId);
      return normalInference.embedding.embed(request);
    },
  },
  textGeneration: {
    generate: request => {
      uiCalls.push(request.modelId);
      return normalInference.textGeneration.generate(request);
    },
  },
};
const cliInference: PluginInferencePort = {
  ...normalInference,
  embedding: {
    async embed(request) {
      cliCalls.push(request.modelId);
      if (mode === 'cancel' && request.values.includes('cancel.md')) {
        waitingForAbort = true;
        await new Promise<void>((_resolve, reject) => {
          const abort = () => {
            cancelledRequests += 1;
            reject(new Error('cancelled fixture provider'));
          };
          if (request.signal?.aborted) abort();
          else request.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return normalInference.embedding.embed(request);
    },
  },
  textGeneration: {
    async generate(request) {
      cliCalls.push(request.modelId);
      attempts += 1;
      if (mode === 'exhaust' || attempts === 1) throw new Error('fetch failed');
      return normalInference.textGeneration.generate(request);
    },
  },
};

vi.mock('@plugin/backend/adoptedHostDataRuntime', () => ({
  getAdoptedHostData: () => ({ database, dataDirectory: path.join(root, 'KnowledgeBase') }),
}));
vi.mock('@plugin/backend/projectReadRuntime', () => ({
  getPluginProjectReadPort: () => ({ get: () => undefined, list: () => [] }),
}));
vi.mock('@plugin/backend/modelConfiguration', () => ({
  getPluginModelConfigurationPort: () => ({
    readDefaultModelIdByCapability: () => null,
  }),
}));
vi.mock('@plugin/backend/inferenceRuntime', () => ({ getPluginInferencePort: () => uiInference }));
vi.mock('@plugin/backend/vectorRuntime', () => ({
  createPluginVectorRuntime: () => ({
    ensureReady: async () => 'http://127.0.0.1:49199',
    stop: async () => {},
  }),
}));
vi.mock('@plugin/backend/pluginRendererPush', () => ({ broadcastRendererPluginMessage: () => {} }));
vi.mock(
  '../knowledge/src/backend/runtime/orchestration/scheduleKnowledgeMaintenance',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../knowledge/src/backend/runtime/orchestration/scheduleKnowledgeMaintenance')
      >();
    return {
      ...actual,
      scheduleKnowledgeMaintenance: (
        ...args: Parameters<typeof actual.scheduleKnowledgeMaintenance>
      ) => {
        maintenanceSchedules += 1;
        return actual.scheduleKnowledgeMaintenance(...args);
      },
    };
  }
);
vi.mock('@plugin/backend/workerQueue', () => ({
  createPluginWorkerQueue: <T extends object>(options: PluginWorkerQueueOptions<T>) =>
    createHostPluginWorkerQueue(options, {
      bootstrapScriptPath: path.join(bundleRoot, 'plugin-runtime.worker.cjs'),
      database: { path: database.name, schemaVersion: SCHEMA_VERSION },
      inference: uiInference,
      environment: process.env,
    }),
}));

beforeAll(async () => {
  await mkdir('node_modules/.cache', { recursive: true });
  bundleRoot = await mkdtemp(path.resolve('node_modules/.cache/knowledge-cli-'));
  await build({
    entryPoints: ['src/infra/task-queue/workers/plugin-runtime.worker.ts'],
    outfile: path.join(bundleRoot, 'plugin-runtime.worker.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    logLevel: 'silent',
  });
  await build({
    entryPoints: ['packages/plugins/__tests__/fixtures/knowledgeCliWorker.ts'],
    outfile: path.join(bundleRoot, 'fixture.worker.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    logLevel: 'silent',
    alias: pluginWorkerSdkAliases(process.cwd()),
    external: ['better-sqlite3'],
  });
});
afterAll(async () => {
  await rm(bundleRoot, { recursive: true, force: true });
});
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-cli-'));
  database = new Database(path.join(root, 'workspace.sqlite'));
  database.pragma(`user_version = ${SCHEMA_VERSION}`);
  database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
  for (const ddl of [...KNOWLEDGE_BASE_SCHEMAS, ...KNOWLEDGE_GRAPH_SCHEMAS]) database.exec(ddl);
  const artifact = path.join(root, 'artifact');
  const workers = path.join(artifact, 'dist/backend/workers');
  await mkdir(workers, { recursive: true });
  for (const name of ['knowledgeIngestion', 'graphExtraction', 'graphIndexing'])
    await copyFile(
      path.join(bundleRoot, 'fixture.worker.cjs'),
      path.join(workers, `${name}.worker.cjs`)
    );
  registeredBackendPluginDirectories.set('knowledge', artifact);
  setPluginRuntimeStateForTests({ enabledPluginIds: ['knowledge'] });
  attempts = 0;
  mode = 'once';
  waitingForAbort = false;
  cancelledRequests = 0;
  maintenanceSchedules = 0;
  uiCalls.length = 0;
  cliCalls.length = 0;
  retryDelays.length = 0;
  // 仅加速既有文档级退避，不改生产重试次数/判定；记录原始延迟确认策略仍生效。
  const originalSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    const retry = delay !== undefined && delay >= 30_000 && delay < 122_000;
    if (retry) retryDelays.push(delay);
    return originalSetTimeout(callback, retry ? 1 : delay, ...args);
  });
  runtime = await createKnowledgeRuntime();
});
afterEach(async () => {
  await runtime?.stop();
  vi.restoreAllMocks();
  registeredBackendPluginDirectories.delete('knowledge');
  clearPluginRuntimeStateForTests();
  database.close();
  await rm(root, { recursive: true, force: true });
});

async function createLibrary(name: string, graph: boolean) {
  const kb = await runtime.service.createKnowledgeBase(name);
  await runtime.metadata.updateKnowledgeBase(kb.id, {
    enableGraphIndexing: graph,
    embeddingModelId: 'indexed-embedding',
  });
  database.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run('project-a');
  database
    .prepare(
      'INSERT INTO project_knowledge_base_links(project_id,kb_id,role,created_at,updated_at) VALUES (?,?,?,?,?)'
    )
    .run('project-a', kb.id, 'read_write', Date.now(), Date.now());
  return kb;
}
async function importDocument(
  kbId: string,
  filename: string,
  signal = new AbortController().signal
) {
  const original = path.join(root, filename);
  await writeFile(original, `original ${filename}`);
  const cli = createKnowledgeCli(() => runtime);
  const prepared = cli.prepare({
    argv: ['documents', 'import', '--kb', kbId, '--source', `conversation:/${filename}`],
    invocationId: 'cli-import',
    conversationRoot: root,
  });
  if (prepared.status !== 'ready') throw new Error('Expected CLI plan');
  const result = await prepared.plan.execute({
    hostContext: undefined,
    projectId: 'project-a',
    signal,
    inference: cliInference,
    modelPurposeSnapshot: {
      embeddingModelId: 'changed-default',
      pdfOcrModelId: null,
      imageVisionModelId: null,
      graphExtractionModelId: 'frozen-graph',
    },
    async stageConversationFile() {
      const staged = path.join(root, `staged-${filename}`);
      await copyFile(original, staged);
      return {
        file: {
          path: staged,
          name: filename,
          size: Buffer.byteLength(`original ${filename}`),
          mimeType: 'text/markdown',
        },
        acceptFile() {},
      };
    },
  });
  expect(await readFile(original, 'utf8')).toBe(`original ${filename}`);
  return result;
}

describe('CLI owned ingestion and graph completion', () => {
  it('失败历史 job 不挡真实重试；CLI 等派生索引完成，保留源文件且不用 UI 推理或回填其他库', async () => {
    const a = await createLibrary('A', true);
    const b = await createLibrary('B', true);
    await runtime.metadata.addDocument({
      ...createDocument('b-history', b.id, 'history.md', 10),
      status: DocumentStatus.COMPLETED,
    });
    await runtime.sot.save('b-history', {
      doc_id: 'b-history',
      doc_title: 'history',
      metadata: {},
      content_blocks: { paragraph: { block_type: BlockType.PARAGRAPH, text: 'history' } },
      structure: { root: ['paragraph'] },
    });
    const result = await importDocument(a.id, 'success.md');
    expect(result.exitCode, result.stderr).toBe(0);
    expect(attempts).toBe(2);
    expect(retryDelays).toHaveLength(1);
    expect(
      runtime.queues
        .listGraphExtractionTasks()
        .map(job => job.state)
        .sort()
    ).toEqual(['completed', 'failed']);
    expect(runtime.queues.listGraphIndexingTasks()).toHaveLength(1);
    expect(runtime.hasActiveTasks()).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: { graph: { extraction: { status: 'completed' }, indexing: { status: 'completed' } } },
    });
    expect(cliCalls).toEqual([
      'indexed-embedding',
      'frozen-graph',
      'frozen-graph',
      'indexed-embedding',
    ]);
    expect(uiCalls).toEqual([]);
    expect(await runtime.graph.getDocumentWorkStatus(b.id, 'b-history')).toEqual({
      extraction: undefined,
      indexing: undefined,
    });
    expect(maintenanceSchedules).toBe(0);
    runtime.startInteractiveMaintenance();
    runtime.startInteractiveMaintenance();
    expect(maintenanceSchedules).toBe(1);
    // 回填本身目前没有图谱抽取模型来源（见 knowledgeGraphQueueOrchestrator），这里只验证维护只排一次。
  });
  it('重试耗尽返回失败并保原文；父取消等待自己的 Host 请求收口，不取消并行 UI 摄入', async () => {
    const a = await createLibrary('A', true);
    mode = 'exhaust';
    const failed = await importDocument(a.id, 'exhaust.md');
    expect(failed.exitCode).toBe(1);
    expect(attempts).toBe(4);
    expect(retryDelays).toHaveLength(3);
    const documents = await runtime.metadata.getDocumentsInKnowledgeBase(a.id);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.status).toBe('completed');
    expect(await runtime.sot.get(documents[0]!.id)).toBeDefined();
    mode = 'cancel';
    const controller = new AbortController();
    const operation = importDocument(a.id, 'cancel.md', controller.signal);
    await vi.waitFor(() => expect(waitingForAbort).toBe(true));
    const b = await createLibrary('UI', false);
    const file = path.join(root, 'ui.md');
    await writeFile(file, 'UI source');
    const ui = await runtime.service.addDocument(b.id, file, 'ui.md', 9, 'ui-embedding');
    controller.abort(new Error('parent cancelled'));
    const cancelled = await operation;
    expect(cancelled.exitCode).toBe(130);
    expect(cancelledRequests).toBe(1);
    await vi.waitFor(() => expect(runtime.queues.getTaskById(ui.taskId)?.state).toBe('completed'));
    expect(await runtime.metadata.getDocumentById(ui.document.id)).toMatchObject({
      status: 'completed',
    });
    expect(
      (await runtime.metadata.getDocumentsInKnowledgeBase(a.id)).find(
        doc => doc.filename === 'cancel.md'
      )
    ).toMatchObject({ status: 'failed' });
    expect(uiCalls).toContain('ui-embedding');
    // 任务状态先变为完成，队列收尾异步结束；等它收口，真正泄漏的任务仍会让等待超时失败。
    await vi.waitFor(() => expect(runtime.hasActiveTasks()).toBe(false));
  });
});
