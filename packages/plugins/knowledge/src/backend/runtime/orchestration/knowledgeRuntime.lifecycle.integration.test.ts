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
import { createBackendPluginUploadEvent, type BackendPluginIpcHandler } from '@plugin/backend/pluginIpcRuntime';
import { createKnowledgeCli } from '../../cli/orchestration/createKnowledgeCli';
import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import type { ToolContext } from '@plugin/backend/toolRuntime';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { KnowledgeSearchTool } from '../../tools/search/KnowledgeSearchTool';
import { SearchInKnowledgeBaseTool } from '../../tools/search/SearchInKnowledgeBaseTool';
import { EmbeddingFailure } from '@plugin/backend/inferenceFailures';

let root: string;
let database: Database.Database;
let bootstrap: string;
let enabled: boolean;
let vectorOwned: boolean;
let vectorOwners: number;
let vectorStarts: number;
let vectorFailure: Error | undefined;
let embeddingFailure: Error | undefined;
let runtime: KnowledgeRuntime | undefined;
const pushes: unknown[] = [];
const inference: PluginInferencePort = {
  embedding: { embed: async request => {
    if (embeddingFailure) throw embeddingFailure;
    return { vectors: request.values.map(() => [1, 0]), spaceId: 'fixture' };
  } },
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
  enabled = true; vectorOwned = false; vectorOwners = 0; vectorStarts = 0; vectorFailure = undefined; embeddingFailure = undefined; pushes.length = 0;
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
      message: '知识库向量服务未能启动：请在插件商店停用并重新启用知识库；若仍失败，请重启 Linnya。', cause: vectorFailure,
    });
    expect(runtime.queues.listIngestionTasks()).toHaveLength(0);
    vectorFailure = undefined;
    await expect(runtime.queues.addIngestionTask(input)).rejects.toHaveProperty('cause.message', 'fixture vector port unavailable');
    await runtime.stop();
    runtime = await createKnowledgeRuntime();
    await expect(runtime.queues.addIngestionTask(input)).resolves.toBe('retry-after-enable');
    expect(vectorOwners).toBe(2);
  });
  it('Windows 数据目录太长：上传不接纳任务、文档记失败并给出换短目录后重启的提示', async () => {
    // Host 在 Qdrant 启动前按目录长度拦下时，跨 artifact 只传错误名称与原因字段。
    vectorFailure = Object.assign(new Error('Qdrant 数据目录长度 131 超过 Windows 上限 100'), {
      name: 'QdrantRuntimeUnavailableError', reason: 'data-directory-too-long',
    });
    const effect = knowledgePlugin.runtimeEffects?.[0];
    if (!effect) throw new Error('Missing knowledge runtime effect');
    await effect.activate();
    const handlers = new Map<string, BackendPluginIpcHandler>();
    knowledgePlugin.ipc?.register(undefined, (_pluginId, channel, handler) => handlers.set(channel, handler));
    const upload = handlers.get('upload-document');
    if (!upload) throw new Error('Missing upload handler');
    const filePath = path.join(root, 'notes.md');
    await writeFile(filePath, '# notes');
    const acceptFile = vi.fn();
    const send = () => upload(
      createBackendPluginUploadEvent({ file: { path: filePath, name: 'notes.md', size: 7 }, signal: new AbortController().signal, acceptFile }),
      { kbId: 'default', embedding_model_id: 'embedding' },
    );
    await expect(send()).resolves.toMatchObject({ success: false,
      userMessage: { key: 'knowledgeBase.runtime.error.vectorDataDirectoryTooLong' } });
    // Host 在同一 activation 保留这次失败，再次上传仍得到同一提示。
    await expect(send()).resolves.toMatchObject({ success: false,
      userMessage: { key: 'knowledgeBase.runtime.error.vectorDataDirectoryTooLong' } });
    expect(acceptFile).not.toHaveBeenCalled();
    const service = getKnowledgeToolRuntime().service;
    const documents = await service.getDocumentsInKnowledgeBase('default');
    expect(documents.map(document => document.status)).toEqual([DocumentStatus.FAILED, DocumentStatus.FAILED]);
    expect(documents[0]?.errorMessage).toMatch(/LINNYA_WORKSPACE_DIR/u);
  });
  it('向量服务启动失败时检索：IPC 带原因的结构化错误，Agent 工具给英文原因，都不回传中文原文', async () => {
    const cases = [
      { reason: 'runtime-missing', key: 'knowledgeBase.runtime.error.vectorRuntimeMissing', hint: /Qdrant runtime .* missing or damaged.*install it again/u },
      { reason: 'data-directory-too-long', key: 'knowledgeBase.runtime.error.vectorDataDirectoryTooLong', hint: /data folder path is too long.*LINNYA_WORKSPACE_DIR/u },
      { reason: 'startup-failed', key: 'knowledgeBase.runtime.error.vectorUnavailable', hint: /failed to start.*disable and re-enable Knowledge Base/u },
    ] as const;
    for (const { reason, key, hint } of cases) {
      vectorFailure = Object.assign(new Error(`Host 诊断原文 ${reason}`), { name: 'QdrantRuntimeUnavailableError', reason });
      const effect = knowledgePlugin.runtimeEffects?.[0];
      if (!effect) throw new Error('Missing knowledge runtime effect');
      await effect.activate();
      const handlers = new Map<string, BackendPluginIpcHandler>();
      knowledgePlugin.ipc?.register(undefined, (_pluginId, channel, handler) => handlers.set(channel, handler));
      const search = handlers.get('search');
      if (!search) throw new Error('Missing search handler');
      // 空库和尚无索引身份的库都在启动向量服务前就返回；要让检索真正走到向量启动，库里得有资料和可用的索引身份。
      const metadata = new BetterSqliteMetadataRepository(database);
      await metadata.addDocument(createDocument(`doc-${reason}`, 'default', 'notes.md', 7));
      metadata.indexState.publishRebuilt('default', { modelId: 'embedding', spaceId: 'fixture' });
      // Agent 工具只在项目对话里检索项目关联的库。
      database.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run('project-a');
      database.prepare('INSERT OR REPLACE INTO project_knowledge_base_links(project_id,kb_id,role,created_at,updated_at) VALUES (?,?,?,?,?)')
        .run('project-a', 'default', 'read_write', Date.now(), Date.now());
      const response = await search(undefined, { kbId: 'default', request: { query: '知识', embeddingModelId: 'embedding', useReranking: false } });
      // 界面据 userMessage.key 按语言取文案；error 只是诊断，不是给用户看的文字。
      expect(response).toMatchObject({ success: false, userMessage: { key } });
      expect(JSON.stringify(response)).not.toContain('Host 诊断原文');

      for (const tool of [new KnowledgeSearchTool(), new SearchInKnowledgeBaseTool()]) {
        const context: ToolContext = { conversationId: 'conversation', turnId: 'turn', workspaceProjectId: 'project-a' };
        attachCitationSequence(context, { offset: 0 });
        attachCitationRefAllocator(context, { allocate: async anchors => anchors.map((_anchor, index) => `Ref${index}`) });
        const failure = await tool.run({ query: 'knowledge' }, context).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).toHaveProperty('message', expect.stringMatching(hint));
        expect(failure).toHaveProperty('message', expect.stringMatching(/^Knowledge search is unavailable: /u));
        // 中文说明留给 CLI 与摄入失败记录，工具结果不能夹带。
        expect(failure).not.toHaveProperty('message', expect.stringMatching(/[\u4e00-\u9fff]/u));
      }
      await effect.deactivate();
    }
  });
  it('检索时嵌入模型失败：IPC 按原因给本地化键，Agent 工具单库与多库都给英文原因，不再返回空结果', async () => {
    const effect = knowledgePlugin.runtimeEffects?.[0];
    if (!effect) throw new Error('Missing knowledge runtime effect');
    await effect.activate();
    const handlers = new Map<string, BackendPluginIpcHandler>();
    knowledgePlugin.ipc?.register(undefined, (_pluginId, channel, handler) => handlers.set(channel, handler));
    const search = handlers.get('search');
    if (!search) throw new Error('Missing search handler');
    const metadata = new BetterSqliteMetadataRepository(database);
    await metadata.createKnowledgeBase({ id: 'second', name: 'Second' });
    database.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run('project-single');
    database.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run('project-multi');
    for (const kbId of ['default', 'second']) {
      await metadata.addDocument(createDocument(`doc-${kbId}`, kbId, 'notes.md', 7));
      metadata.indexState.publishRebuilt(kbId, { modelId: 'embedding', spaceId: 'fixture' });
    }
    const link = database.prepare('INSERT OR REPLACE INTO project_knowledge_base_links(project_id,kb_id,role,created_at,updated_at) VALUES (?,?,?,?,?)');
    link.run('project-single', 'default', 'read_write', Date.now(), Date.now());
    link.run('project-multi', 'default', 'read_write', Date.now(), Date.now());
    link.run('project-multi', 'second', 'read_write', Date.now(), Date.now());

    const cases = [
      { failure: new EmbeddingFailure('protocol', 'model_not_found', false, 'Host 诊断原文 模型不存在'), key: 'knowledgeBase.search.error.embeddingModelUnavailable', hint: /embedding model used for this knowledge base is unavailable.*Settings › Models/u },
      { failure: new EmbeddingFailure('protocol', 'credential_missing', false, 'Host 诊断原文 缺少凭据'), key: 'knowledgeBase.search.error.embeddingCredential', hint: /no API key, or the provider rejected the key/u },
      { failure: new EmbeddingFailure('transport', 'provider_transport_error', true, 'Host 诊断原文 网络失败'), key: 'knowledgeBase.search.error.embeddingRequestFailed', hint: /request to the embedding model did not succeed.*Retrying later may help/u },
    ] as const;
    for (const { failure, key, hint } of cases) {
      embeddingFailure = failure;
      const response = await search(undefined, { kbId: 'default', request: { query: '知识', embeddingModelId: 'embedding', useReranking: false } });
      // 界面据 userMessage.key 按语言取文案；error 只是诊断，不能是“成功但 0 条”。
      expect(response).toMatchObject({ success: false, userMessage: { key } });
      expect(response).not.toHaveProperty('userMessage.params');

      for (const projectId of ['project-single', 'project-multi']) {
        for (const tool of [new KnowledgeSearchTool(), new SearchInKnowledgeBaseTool()]) {
          const context: ToolContext = { conversationId: 'conversation', turnId: 'turn', workspaceProjectId: projectId };
          attachCitationSequence(context, { offset: 0 });
          attachCitationRefAllocator(context, { allocate: async anchors => anchors.map((_anchor, index) => `Ref${index}`) });
          const result = await tool.run({ query: 'knowledge' }, context).catch((error: unknown) => error);
          expect(result).toBeInstanceOf(Error);
          expect(result).toHaveProperty('message', expect.stringMatching(/^Knowledge search failed: /u));
          expect(result).toHaveProperty('message', expect.stringMatching(hint));
          expect(result).not.toHaveProperty('message', expect.stringMatching(/[\u4e00-\u9fff]/u));
        }
      }
    }
    // 嵌入失败在检索之前，不需要也不会启动向量服务。
    expect(vectorStarts).toBe(0);
  });
  it('数据目录未超限：同样的上传照常接纳任务', async () => {
    const effect = knowledgePlugin.runtimeEffects?.[0];
    if (!effect) throw new Error('Missing knowledge runtime effect');
    await effect.activate();
    const handlers = new Map<string, BackendPluginIpcHandler>();
    knowledgePlugin.ipc?.register(undefined, (_pluginId, channel, handler) => handlers.set(channel, handler));
    const upload = handlers.get('upload-document');
    if (!upload) throw new Error('Missing upload handler');
    const filePath = path.join(root, 'complete.md');
    await writeFile(filePath, '# notes');
    const acceptFile = vi.fn();
    await expect(upload(
      createBackendPluginUploadEvent({ file: { path: filePath, name: 'complete.md', size: 7 }, signal: new AbortController().signal, acceptFile }),
      { kbId: 'default', embedding_model_id: 'embedding' },
    )).resolves.toMatchObject({ success: true });
    expect(vectorStarts).toBe(1);
    expect(acceptFile).toHaveBeenCalledOnce();
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
    expect(runtime.getDeactivationBlocker()).toBe('active-tool');
    release();
    expect(runtime.getDeactivationBlocker()).toBeUndefined();
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
