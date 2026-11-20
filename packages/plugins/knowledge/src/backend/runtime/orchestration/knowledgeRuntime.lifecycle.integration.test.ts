import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION } from 'src/electron-main/services/database/migrations';
import type { PluginInferencePort } from '@plugin/backend/inferenceRuntime';
import type { PluginWorkerQueueOptions } from '@plugin/backend/workerQueue';
import { createHostPluginWorkerQueue } from 'src/app-hosts/linnya/adapters/plugin-worker-queue/orchestration/createHostPluginWorkerQueue';
import { registeredBackendPluginDirectories } from 'src/app-hosts/linnya/plugin-registry/registeredPluginDirectories';
import { setPluginRuntimeStateForTests, clearPluginRuntimeStateForTests } from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { KNOWLEDGE_BASE_SCHEMAS, KNOWLEDGE_GRAPH_SCHEMAS } from '../../database/schemas';
import { createKnowledgeRuntime, type KnowledgeRuntime } from './createKnowledgeRuntime';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { createDocument, DocumentStatus } from '../../domain/document';
import { BlockType, type DocumentSoT } from '../../domain/block';
import { KnowledgeQueues } from '../../queue/orchestration/KnowledgeQueues';
import { createKnowledgeActivityOwner } from './createKnowledgeActivityOwner';
import knowledgePlugin from '../../index';
import { getKnowledgeToolRuntime } from '../../tools/runtime/knowledgeToolRuntime';
import type { BackendPluginIpcHandler } from '@plugin/backend/pluginIpcRuntime';
import { createKnowledgeCli } from '../../cli/orchestration/createKnowledgeCli';
import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';

let root: string;
let database: Database.Database;
let bootstrap: string;
let enabled: boolean;
let vectorOwned: boolean;
let vectorOwners: number;
let vectorStarts: number;
let vectorFailure: Error | undefined;
let runtime: KnowledgeRuntime | undefined;
const pushes: unknown[] = [];
const inference: PluginInferencePort = {
  embedding: { embed: async request => ({ vectors: request.values.map(() => [1, 0]), spaceId: 'fixture' }) },
  reranking: { rerank: async () => ({ ranking: [] }) },
  textGeneration: { generate: async () => ({ text: '{}', reasoning: '', finishReason: 'stop' }) },
  documentOcr: { resolveModelProfile: async () => undefined, recognizeDocument: async () => ({ pages: [] }) },
};

vi.mock('@plugin/backend/adoptedHostDataRuntime', () => ({ getAdoptedHostData: () => ({ database, dataDirectory: path.join(root, 'Plugins/knowledge') }) }));
vi.mock('@plugin/backend/projectReadRuntime', () => ({ getPluginProjectReadPort: () => ({ get: () => undefined, list: () => [] }) }));
vi.mock('@plugin/backend/modelConfiguration', () => ({ getPluginModelConfigurationPort: () => ({
  readDefaultModelIdByCapability: () => 'ocr', readAuxiliaryModelBinding: () => 'language', getModelDisplayName: (id: string) => id,
}) }));
vi.mock('@plugin/backend/inferenceRuntime', () => ({ getPluginInferencePort: () => inference }));
vi.mock('@plugin/backend/vectorRuntime', () => ({ createPluginVectorRuntime: () => {
  if (vectorOwned) throw new Error('previous vector owner remains');
  vectorOwned = true; vectorOwners += 1;
  const failure = vectorFailure;
  return { ensureReady: async () => { vectorStarts += 1; if (failure) throw failure; return 'http://127.0.0.1:49199'; }, stop: async () => { vectorOwned = false; } };
} }));
vi.mock('@plugin/backend/pluginRendererPush', () => ({ broadcastRendererPluginMessage: (...payload: unknown[]) => {
  if (!enabled) throw new Error('disabled plugin cannot publish');
  pushes.push(payload);
} }));
vi.mock('@plugin/backend/workerQueue', () => ({ createPluginWorkerQueue: <T extends object>(options: PluginWorkerQueueOptions<T>) =>
  createHostPluginWorkerQueue({ ...options, maxConcurrency: 1 }, {
    bootstrapScriptPath: bootstrap, database: { path: database.name, schemaVersion: SCHEMA_VERSION }, inference, environment: process.env,
  }),
}));

const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
if (workerData.filename === 'complete.md' || workerData.filename === 'duplicate.md') {
  parentPort.postMessage({ type: 'completed', result: { frontendState: { doc_id: workerData.docId }, complete: true, duplicate: workerData.filename === 'duplicate.md' } });
  parentPort.close();
} else {
  const keepAlive = setInterval(() => {}, 1000);
  parentPort.on('message', message => {
    if (message.cmd === 'cancel') {
      mkdirSync(workerData.runtime.temporaryDirectory, { recursive: true });
      writeFileSync(path.join(workerData.runtime.temporaryDirectory, 'settled.txt'), 'stopped');
      clearInterval(keepAlive); parentPort.close();
    }
  });
  parentPort.postMessage({ type: 'progress', progress: 1, data: { doc_id: workerData.docId, status: 'processing' } });
}
`;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-activation-'));
  database = new Database(path.join(root, 'workspace.sqlite'));
  database.pragma(`user_version = ${SCHEMA_VERSION}`);
  database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
  for (const ddl of [...KNOWLEDGE_BASE_SCHEMAS, ...KNOWLEDGE_GRAPH_SCHEMAS]) database.exec(ddl);
  const artifact = path.join(root, 'artifact');
  const workers = path.join(artifact, 'dist/backend/workers');
  await mkdir(workers, { recursive: true });
  for (const name of ['knowledgeIngestion', 'graphExtraction', 'graphIndexing']) await writeFile(path.join(workers, `${name}.worker.cjs`), workerSource);
  bootstrap = path.join(root, 'plugin-runtime.worker.cjs');
  await build({ entryPoints: ['src/infra/task-queue/workers/plugin-runtime.worker.ts'], outfile: bootstrap,
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'silent' });
  registeredBackendPluginDirectories.set('knowledge', artifact);
  setPluginRuntimeStateForTests({ enabledPluginIds: ['knowledge'] });
  enabled = true; vectorOwned = false; vectorOwners = 0; vectorStarts = 0; vectorFailure = undefined; pushes.length = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await knowledgePlugin.runtimeEffects?.[0]?.deactivate();
  await runtime?.stop(); runtime = undefined;
  registeredBackendPluginDirectories.delete('knowledge'); clearPluginRuntimeStateForTests();
  database.close(); await rm(root, { recursive: true, force: true });
});

function source(id: string): DocumentSoT {
  return { doc_id: id, doc_title: id, metadata: {}, content_blocks: {
    paragraph: { block_type: BlockType.PARAGRAPH, text: 'retained source' },
  }, structure: { root: ['paragraph'] } };
}
async function addJob(id: string, filename = 'running.pdf') {
  if (!runtime) throw new Error('missing runtime');
  await runtime.metadata.addDocument(createDocument(id, 'default', filename, 20));
  const filePath = path.join(root, `${id}.pdf`);
  await writeFile(filePath, 'original bytes');
  await runtime.originals.save({ kbId: 'default', docId: id, sourcePath: filePath, originalFilename: 'retained.pdf' });
  await runtime.sot.save(id, source(id));
  await runtime.queues.addIngestionTask({ taskId: id, docId: id, kbId: 'default', filename, filePath,
    embeddingModelId: 'embedding', forceVisionMode: false, priority: 1, retry: false });
}

describe('knowledge activation persistence and drain', () => {
  it('CLI 准备不访问 runtime；真实项目范围只读、无模型且不启动向量，不能用 A 的库删除 B 的资料', async () => {
    const unavailable = vi.fn((): KnowledgeRuntime => { throw new Error('must not access runtime in prepare'); });
    const help = createKnowledgeCli(unavailable).prepare({ argv: ['--help'], invocationId: 'help', conversationRoot: root });
    expect(help.status).toBe('completed');
    expect(createKnowledgeCli(unavailable).prepare({ argv: ['list'], invocationId: 'list', conversationRoot: root }).status).toBe('ready');
    expect(unavailable).not.toHaveBeenCalled();
    runtime = await createKnowledgeRuntime();
    const a = await runtime.service.createKnowledgeBase('A');
    const b = await runtime.service.createKnowledgeBase('B');
    database.prepare('INSERT INTO projects(id) VALUES (?)').run('project-a');
    database.prepare('INSERT INTO project_knowledge_base_links(project_id,kb_id,role,created_at,updated_at) VALUES (?,?,?,?,?)').run('project-a', a.id, 'read_write', Date.now(), Date.now());
    await runtime.metadata.addDocument(createDocument('private-b', b.id, 'private.md', 12));
    await runtime.sot.save('private-b', source('private-b'));
    const cli = createKnowledgeCli(() => { if (!runtime) throw new Error('missing runtime'); return runtime; });
    const context: BackendPluginCliExecutionContext = { hostContext: undefined, projectId: 'project-a', signal: new AbortController().signal };
    async function run(argv: string[]) {
      const prepared = cli.prepare({ argv, invocationId: 'metadata', conversationRoot: root });
      if (prepared.status !== 'ready') return prepared.result;
      expect(prepared.plan.access.hostInference).toBeUndefined();
      expect(prepared.plan.access.conversationFiles).toBe('none');
      return prepared.plan.execute(context);
    }
    const listed = await run(['list']);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({ data: { libraries: [{ id: a.id, role: 'read_write', implicit: false }] } });
    expect(listed.stdout).not.toContain(b.id);
    expect((await run(['documents', 'list', '--kb', b.id])).exitCode).toBe(77);
    expect((await run(['documents', 'delete', '--kb', a.id, '--document', 'private-b'])).exitCode).toBe(77);
    expect(await runtime.sot.get('private-b')).toEqual(source('private-b'));
    expect(await runtime.metadata.getDocumentById('private-b')).toMatchObject({ kbId: b.id });
    const status = await run(['index', 'status', '--kb', a.id]);
    expect(JSON.parse(status.stdout)).toMatchObject({ data: { identity: { modelId: null, spaceId: null }, rebuild: null } });
    expect(vectorStarts).toBe(0);
  });
  it('CLI read_only 可解除本项目关联但保留共享库；无绑定 default 只读，关联读取错误不降级', async () => {
    runtime = await createKnowledgeRuntime();
    const kb = await runtime.service.createKnowledgeBase('shared');
    for (const project of ['project-a', 'project-b']) {
      database.prepare('INSERT INTO projects(id) VALUES (?)').run(project);
      database.prepare('INSERT INTO project_knowledge_base_links(project_id,kb_id,role,created_at,updated_at) VALUES (?,?,?,?,?)').run(project, kb.id, 'read_only', Date.now(), Date.now());
    }
    const cli = createKnowledgeCli(() => { if (!runtime) throw new Error('missing runtime'); return runtime; });
    async function run(argv: string[], projectId = 'project-a') {
      const prepared = cli.prepare({ argv, invocationId: 'shared', conversationRoot: root });
      return prepared.status === 'completed' ? prepared.result : prepared.plan.execute({ hostContext: undefined, projectId, signal: new AbortController().signal });
    }
    expect((await run(['index', 'rebuild', '--kb', kb.id])).exitCode).toBe(77);
    expect((await run(['unlink', '--kb', kb.id])).exitCode).toBe(0);
    expect(await runtime.links.listKnowledgeBasesForProject('project-a')).toEqual([]);
    expect(await runtime.links.listKnowledgeBasesForProject('project-b')).toEqual([kb.id]);
    expect(await runtime.service.getKnowledgeBaseById(kb.id)).toBeDefined();
    expect(JSON.parse((await run(['list'])).stdout)).toMatchObject({ data: { libraries: [{ id: 'default', implicit: true }] } });
    expect((await run(['unlink', '--kb', 'default'])).exitCode).toBe(77);
    expect((await run(['index', 'rebuild', '--kb', 'default'])).exitCode).toBe(77);
    database.exec('DROP TABLE project_knowledge_base_links');
    const failed = await run(['list']);
    expect(failed.exitCode).toBe(1); expect(failed.stdout).toBe('');
    expect(vectorStarts).toBe(0);
  });
  it('本插件元数据故障不使激活失败，IPC与工具说明局部故障，停启后可以恢复', async () => {
    const effect = knowledgePlugin.runtimeEffects?.[0];
    if (!effect) throw new Error('Missing knowledge runtime effect');
    database.exec("CREATE TRIGGER fixture_readonly BEFORE INSERT ON knowledge_bases BEGIN SELECT RAISE(ABORT, 'fixture metadata unavailable'); END");
    await expect(effect.activate()).resolves.toBeUndefined();
    expect(vectorOwners).toBe(0);
    expect(effect.hasActiveWork?.()).toBe(false);
    expect(() => getKnowledgeToolRuntime().enterTool()).toThrow('fixture metadata unavailable');
    const handlers = new Map<string, BackendPluginIpcHandler>();
    knowledgePlugin.ipc?.register(undefined, (_pluginId, channel, handler) => handlers.set(channel, handler));
    const list = handlers.get('list');
    if (!list) throw new Error('Missing catalog handler');
    await expect(list(undefined, {})).resolves.toMatchObject({ success: false,
      userMessage: { key: 'knowledgeBase.runtime.error.preparationFailed' } });
    await effect.deactivate();
    expect(() => getKnowledgeToolRuntime()).toThrow('未启用');
    database.exec('DROP TRIGGER fixture_readonly');
    await effect.activate();
    await expect(getKnowledgeToolRuntime().service.getAllKnowledgeBases()).resolves.toHaveLength(1);
    expect(vectorOwners).toBe(1);
    expect(vectorStarts).toBe(0);
  });
  it('向量启动失败给出停启指引并保留原因，新 activation 可以恢复', async () => {
    vectorFailure = new Error('fixture vector port unavailable');
    runtime = await createKnowledgeRuntime();
    const input = { taskId: 'retry-after-enable', kbId: 'default', docId: 'retry-source', filename: 'running.pdf',
      filePath: path.join(root, 'source.pdf'), embeddingModelId: 'embedding', forceVisionMode: false, priority: 1, retry: false };
    await expect(runtime.queues.addIngestionTask(input)).rejects.toMatchObject({
      message: '知识库向量服务未能启动，请检查运行日志，修复后停用并重新启用知识库。', cause: vectorFailure,
    });
    expect(runtime.queues.listIngestionTasks()).toHaveLength(0);
    vectorFailure = undefined;
    await expect(runtime.queues.addIngestionTask(input)).rejects.toHaveProperty('cause.message', 'fixture vector port unavailable');
    await runtime.stop();
    runtime = await createKnowledgeRuntime();
    await expect(runtime.queues.addIngestionTask(input)).resolves.toBe('retry-after-enable');
    expect(vectorOwners).toBe(2);
  });
  it('真实摄入Worker未退出前维护与重建不可进入，取消释放后可以维护，其他库不受影响', async () => {
    const activity = createKnowledgeActivityOwner();
    const queue = new KnowledgeQueues({ activity,
      paths: { sotDirectory: root, originalsDirectory: root, temporaryDirectory: root },
      resolveVectorUrl: async () => 'http://127.0.0.1:49199',
    });
    const input = { taskId: 'owned-task', kbId: 'library', docId: 'document', filename: 'running.pdf',
      filePath: path.join(root, 'source.pdf'), embeddingModelId: 'embedding', forceVisionMode: false, priority: 1, retry: false };
    try {
      const ready = new Promise<void>(resolve => queue.once('ingestion:taskProgress', () => resolve()));
      await queue.addIngestionTask(input); await ready;
      expect(() => activity.begin('library', 'maintenance')).toThrow('正在执行');
      expect(() => activity.begin('library', 'rebuild')).toThrow('正在执行');
      const other = activity.begin('other', 'maintenance'); other.release();
      await queue.cancelIngestionTask('owned-task'); await activity.whenIdle('library');
      expect(await readFile(path.join(root, 'owned-task/settled.txt'), 'utf8')).toBe('stopped');
      const maintenance = activity.begin('library', 'maintenance');
      await expect(queue.addIngestionTask({ ...input, taskId: 'must-not-start' })).rejects.toThrow('正在执行');
      maintenance.release(); expect(activity.hasActivity()).toBe(false);
    } finally { await queue.shutdown(); await activity.drain(); }
  });

  it('重复上传只清本次文件，停用等待该清理结算后才结束', async () => {
    runtime = await createKnowledgeRuntime();
    await addJob('original', 'complete.md');
    await vi.waitFor(() => expect(runtime?.hasActiveTasks()).toBe(false));
    const originalDelete = runtime.originals.delete.bind(runtime.originals);
    let allowCleanup: () => void = () => {};
    const cleanupAllowed = new Promise<void>(resolve => { allowCleanup = resolve; });
    const cleanup = vi.spyOn(runtime.originals, 'delete').mockImplementation(async (kbId, docId) => {
      await cleanupAllowed;
      return originalDelete(kbId, docId);
    });
    await addJob('duplicate', 'duplicate.md');
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledWith('default', 'duplicate'));
    let stopped = false;
    const stop = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    allowCleanup(); await stop;
    expect(await runtime.originals.getPath('default', 'duplicate')).toBeUndefined();
    expect(await runtime.originals.getPath('default', 'original')).toBeDefined();
    expect(await runtime.sot.get('original')).toEqual(source('original'));
  });

  it('默认库初始化失败不领取向量 owner，解除故障后同 Host 可重新启用且冷态不启进程', async () => {
    vi.spyOn(BetterSqliteMetadataRepository.prototype, 'getKnowledgeBaseById').mockRejectedValueOnce(new Error('sqlite read unavailable'));
    await expect(createKnowledgeRuntime()).rejects.toThrow('sqlite read unavailable');
    expect(vectorOwners).toBe(0);
    runtime = await createKnowledgeRuntime();
    expect(vectorOwners).toBe(1);
    expect(vectorStarts).toBe(0);
    expect((await runtime.service.getAllKnowledgeBases()).map(kb => kb.id)).toEqual(['default']);
    expect(vectorStarts).toBe(0);
    const release = runtime.toolRuntime.enterTool();
    expect(() => runtime?.assertCanDeactivate()).toThrow('工具仍在运行');
    release(); runtime.assertCanDeactivate();
  });

  it('停用等待真实 pending/running Worker，重开SQLite可见失败，completed与原文/PDF保持原样', async () => {
    runtime = await createKnowledgeRuntime();
    await addJob('completed', 'complete.md');
    await vi.waitFor(() => expect(runtime?.hasActiveTasks()).toBe(false));
    await runtime.metadata.updateDocumentStatus('completed', DocumentStatus.COMPLETED);
    await addJob('running');
    await vi.waitFor(() => expect(runtime?.queues.getTaskById('running')?.state).toBe('running'));
    await runtime.metadata.updateDocumentStatus('running', DocumentStatus.PROCESSING);
    await addJob('pending');
    expect(runtime.queues.getTaskById('pending')?.state).toBe('pending');
    const pushCount = pushes.length;
    enabled = false; setPluginRuntimeStateForTests({ enabledPluginIds: [] });
    runtime.beginDeactivation();
    expect(() => runtime?.assertAccepting()).toThrow('停用');
    // CLI 先收口时会先于最终 runtime.stop 取消 Worker；不得再向 disabled Renderer 发布。
    await runtime.queues.cancelIngestionTask('pending');
    await runtime.stop();
    expect(pushes).toHaveLength(pushCount);
    expect(runtime.hasActiveTasks()).toBe(false);
    const reopened = new Database(database.name, { readonly: true });
    try {
      expect(reopened.prepare('SELECT id,status FROM kb_documents ORDER BY id').all()).toEqual([
        { id: 'completed', status: 'completed' }, { id: 'pending', status: 'failed' }, { id: 'running', status: 'failed' },
      ]);
    } finally { reopened.close(); }
    for (const id of ['completed', 'pending', 'running']) {
      expect(await runtime.sot.get(id)).toEqual(source(id));
      const original = await runtime.originals.getPath('default', id);
      expect(original).toBeDefined();
      if (!original) throw new Error('retained PDF missing');
      expect(await readFile(original, 'utf8')).toBe('original bytes');
    }
    enabled = true; setPluginRuntimeStateForTests({ enabledPluginIds: ['knowledge'] });
    runtime = await createKnowledgeRuntime();
    expect((await runtime.service.getDocumentsInKnowledgeBase('default')).map(doc => doc.id).sort()).toEqual(['completed','pending','running']);
    expect(vectorOwners).toBe(2);
  });

  it('SQLite终态落盘一次失败后仍保留最初任务身份，再次停用完成该批收尾', async () => {
    runtime = await createKnowledgeRuntime();
    await addJob('running');
    await vi.waitFor(() => expect(runtime?.queues.getTaskById('running')?.state).toBe('running'));
    database.exec("CREATE TRIGGER interrupted_status BEFORE UPDATE ON kb_documents WHEN NEW.status = 'failed' BEGIN SELECT RAISE(ABORT, 'write interrupted'); END");
    enabled = false; setPluginRuntimeStateForTests({ enabledPluginIds: [] });
    await expect(runtime.stop()).rejects.toThrow('知识库中断状态未保存');
    expect(vectorOwned).toBe(true);
    database.exec('DROP TRIGGER interrupted_status');
    await runtime.stop();
    expect((await runtime.metadata.getDocumentById('running'))?.status).toBe(DocumentStatus.FAILED);
    expect(vectorOwned).toBe(false);
  });

  it('图谱回填等待SoT时停用，收尾等待旧读取且不会写queued或启动新任务', async () => {
    runtime = await createKnowledgeRuntime();
    await runtime.metadata.addDocument({ ...createDocument('graph-doc','default','graph.md',20), status: DocumentStatus.COMPLETED });
    database.prepare("UPDATE knowledge_bases SET enable_graph_indexing=1, embedding_model_id='embedding', embedding_space_id='fixture' WHERE id=?").run('default');
    let release: (value: DocumentSoT) => void = () => {};
    const delayed = new Promise<DocumentSoT>(resolve => { release = resolve; });
    const read = vi.spyOn(runtime.sot, 'get').mockReturnValueOnce(delayed);
    runtime.graph.startBackfill();
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    release(source('graph-doc')); await stopping;
    expect(database.prepare('SELECT * FROM knowledge_graph_doc_status').all()).toEqual([]);
    expect(runtime.queues.listGraphExtractionTasks()).toEqual([]);
  });
});
