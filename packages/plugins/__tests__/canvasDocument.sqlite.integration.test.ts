import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canvasPluginMigrations, createCanvasDocumentRuntime, createCanvasBackendPlugin, readCanvasSelectionContext } from '@plugin/canvas/backend-test-support';
import { createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema';
import { DOCUMENT_REFERENCE_SCHEMAS, createDocumentReferenceOperations } from 'src/domains/document-references';
import { readWorkspaceDocumentIdentity, readWorkspaceDocumentLocation } from 'src/plugin-sdk/backend/workspaceDocumentProjection';
import { createProjectLifecycle } from 'src/domains/projects';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { installPluginHostTestRuntime, resetPluginHostTestRuntime } from 'src/plugin-sdk/backend/testRuntime';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { platformBackendPlugin } from 'src/app-hosts/linnya/plugin-registry/builtin/platform.backend';
import { installBackendRendererIntegrationPort, clearBackendRendererIntegrationPortForTesting } from 'src/app-hosts/linnya/desktop-capabilities';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';

let db: Database.Database;
let runtime: ReturnType<typeof createCanvasDocumentRuntime>;
let projectId: string;
const push = vi.fn();
const text = (value: string) => ({ op: 'addText', content: createCanvasPlainTextDocument(value), width: 240, height: 120 });
beforeEach(() => {
  db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  for (const ddl of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS, ...CONVERSATION_SCHEMAS]) db.exec(ddl);
  for (const migration of canvasPluginMigrations) migration.up(db);
  installPluginHostTestRuntime({ installedPluginIds: ['platform', 'canvas'], enabledPluginIds: ['platform', 'canvas'] });
  backendPluginRegistry.register(platformBackendPlugin);
  backendPluginRegistry.register(createCanvasBackendPlugin(), { allowPluginCli: true });
  push.mockClear();
  installBackendRendererIntegrationPort({ connectModelCatalogUpdates: async () => () => undefined,
    publishIngestionStatus: vi.fn(), queueJobPresentationPublisher: { publishProgress: vi.fn(), publishCompletion: vi.fn(), publishFailure: vi.fn() },
    publishKnowledgeGraphProgress: vi.fn(), publishTranscriptionProgress: vi.fn(), publishWorkspaceMutation: vi.fn(),
    publishPluginRendererPush: push, publishTodosChanged: vi.fn(), publishModelsChanged: vi.fn(), publishPluginsChanged: vi.fn(),
  });
  projectId = createProjectLifecycle(db).create({ name: '画布测试' });
  runtime = createCanvasDocumentRuntime(db);
});
it('refreshes a closed canvas from a single committed version and keeps the sent snapshot immutable', () => {
  const id = runtime.create({ projectId, parentId: null, name: '发送.canvas' });
  db.prepare('INSERT INTO conversations(conversation_id,created_at,last_event_at,project_id) VALUES (?,1,1,?)').run('chat', projectId);
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'add', operations: [text('旧正文')] });
  runtime.close(id, 'view');
  const first = readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], conversationId: 'chat' });
  runtime.commit({ documentId: id, viewId: 'another', requestId: 'edit', operations: [{ op: 'update', id: 'c1', baseRevision: 1,
    patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('最新正文') } } }] });
  const refreshed = readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], conversationId: 'chat' });
  expect(refreshed.sequence).toBe(2); expect(refreshed.text).toContain('最新正文');
  expect(first.text).toContain('旧正文'); expect(first.sequence).toBe(1);
  expect(() => readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], projectId: 'other-project' })).toThrow('其他项目');
  expect(() => readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], projectId: null })).toThrow('项目');
  db.prepare('UPDATE conversations SET project_id = NULL WHERE conversation_id = ?').run('chat');
  expect(() => readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], conversationId: 'chat' })).toThrow('项目');
});
it('rejects missing selected cards instead of sending a stale stored reference', () => {
  const id = runtime.create({ projectId, parentId: null, name: '删除.canvas' });
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'add', operations: [text('已选择')] });
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'delete', operations: [{ op: 'delete', id: 'c1' }] });
  expect(() => readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'] })).toThrow('重新选择');
});
it('refreshes a partially deleted selection using only remaining committed cards', () => {
  const id = runtime.create({ projectId, parentId: null, name: '部分.canvas' });
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'add', operations: [text('已删除'), text('仍存在')] });
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'delete', operations: [{ op: 'delete', id: 'c1' }] });
  const context = readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1', 'c2'] });
  expect(context.elementIds).toEqual(['c2']); expect(context.text).toContain('仍存在'); expect(context.text).not.toContain('已删除');
});
afterEach(async () => {
  runtime.dispose();
  await new Promise(resolve => setTimeout(resolve, 0));
  backendPluginRegistry.clear(); resetPluginHostTestRuntime(); clearBackendRendererIntegrationPortForTesting(); db.close();
});
it('creates, commits, closes and reopens through actual Host projection and current paths', () => {
  const id = runtime.create({ projectId, parentId: null, name: '讨论' });
  runtime.read(id, projectId, 'view');
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'first', operations: [text('中文正文')] });
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ channel: 'canvas:changed', payload: { documentId: id, sequence: 1 } }));
  runtime.close(id, 'view');
  expect(runtime.read(id).elements).toHaveLength(1);
  expect(runtime.project(id)).toContain('中文正文');
  expect(db.prepare('SELECT text FROM workspace_node_text_snapshots WHERE node_id = ?').get(id)).toEqual({ text: '[c1] 中文正文' });
  const workspace = new WorkspaceService(db);
  workspace.renameNode(id, '重命名.canvas');
  expect(readWorkspaceDocumentLocation(db, id)?.path).toContain('重命名.canvas');
});
it('keeps references atomic and hides moved targets without retargeting a reused name', () => {
  const workspace = new WorkspaceService(db);
  const target = workspace.createNode({ projectId, parentId: null, type: 'document', name: '资料' });
  const id = runtime.create({ projectId, parentId: null, name: '引用' });
  const operations = [{ op: 'addDocument', data: { documentId: target.id }, width: 240, height: 180 }];
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'reference', operations });
  const refs = createDocumentReferenceOperations(db, { read: key => readWorkspaceDocumentIdentity(db, key) });
  expect(refs.listBacklinks(target.id)).toHaveLength(1);
  expect(() => runtime.commit({ documentId: id, viewId: 'view', requestId: 'bad', operations: [text('整批回滚'), { ...operations[0], data: { documentId: 'missing' } }] })).toThrow();
  expect(runtime.read(id).elements).toHaveLength(1);
  const otherProject = createProjectLifecycle(db).create({ name: '另一项目' });
  db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(otherProject, target.id);
  expect(runtime.project(id)).toContain('文档当前不可访问');
  expect(runtime.project(id)).not.toContain(target.id);
  expect(() => runtime.editing.commitAgent({ request: { documentId: id, requestId: 'wrong-project', operations: [text('不应写入')] }, actor: { projectId: otherProject, viewId: 'agent', source: { kind: 'agent', conversationId: 'chat', runId: 'run' } }, now: Date.now(), intent: 'apply' })).toThrow('其他项目');
  expect(runtime.read(id).elements).toHaveLength(1);
});

it('runs the real semantic CLI against Host SQLite with frozen scope, idempotent append and actual layout worker', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const path = await import('node:path');
  const { executeCanvasCliCommand, createCanvasComputationRuntime, createCanvasPluginCli, formatCanvasCliInputError } = await import('@plugin/canvas/backend-test-support');
  const root = await mkdtemp(path.join(tmpdir(), 'canvas-cli-test-'));
  const computation = createCanvasComputationRuntime({ workerPath: path.resolve('packages/plugins/canvas/dist/backend/canvas-computation-worker.cjs') });
  const id = runtime.create({ projectId, parentId: null, name: '命令.canvas' });
  let measureCalls = 0;
  // 测高像素由正式Electron worker门禁另验；此处检查Host作用域、异步编排、事务和真实Node布局。
  const services: import('@plugin/canvas/backend-test-support').CanvasCliServices = { runtimeFor: () => runtime, referencesFor: () => runtime.references,
    capabilities: { computation, measurement: { async measureBatch(request) { measureCalls++; return request.cards.map(card => ({ ref: card.ref, width: card.width, height: 120 })); },
      async measure(request) { return { width: request.width, height: 120 }; } }, rendering: { async render() { throw new Error('not a render test'); } } } };
  const context = { hostContext: { databaseService: { getDb: () => db }, workspaceProjectId: projectId, conversationId: 'chat' }, projectId, conversationId: 'chat', agentRunId: 'run', signal: new AbortController().signal };
  const cli = createCanvasPluginCli((command, execution, directory) => executeCanvasCliCommand(command, execution, directory, services), formatCanvasCliInputError);
  const run = async (argv: string[]) => {
    const prepared = cli.prepare({ argv, invocationId: 'invocation', conversationRoot: root });
    if (prepared.status === 'completed') return prepared.result;
    return prepared.plan.execute(context);
  };
  try {
    await writeFile(path.join(root, 'batch.json'), JSON.stringify([{ op: 'add', ref: '$a', text: '## 原文' }, { op: 'add', ref: '$b', text: '第二张' }, { op: 'connect', from: '$a', to: '$b' }, { op: 'arrange', algorithm: 'tree', elementIds: ['$a', '$b'] }]));
    const argv = ['apply', 'workspace:/命令.canvas', '--ops-file', 'batch.json', '--request-id', 'create'];
    const planned = cli.prepare({ argv, invocationId: 'scope', conversationRoot: root });
    expect(planned.status === 'ready' && planned.plan.access.conversationFiles).toBe('write');
    const created = await run(argv); expect(created.exitCode, created.stdout).toBe(0); expect(created.stdout).toContain('committed'); expect(created.stdout).not.toContain(id);
    expect(runtime.read(id).elements).toHaveLength(3); expect(measureCalls).toBe(1);
    expect(await run(argv)).toEqual(created); expect(measureCalls).toBe(1);
    await writeFile(path.join(root, 'append.json'), JSON.stringify([{ op: 'update', id: 'c1', revision: runtime.read(id).elements.find(element => element.id === 'c1')!.revision, append: '只追加一次' }]));
    const append = ['apply', 'workspace:/命令.canvas', '--ops-file', 'append.json', '--request-id', 'append'];
    const first = await run(append); expect(first.exitCode).toBe(0);
    runtime.commit({ documentId: id, viewId: 'view', requestId: 'change-color', operations: [{ op: 'update', id: 'c1', baseRevision: runtime.read(id).elements.find(element => element.id === 'c1')!.revision, patch: { color: 'yellow' } }] });
    expect(await run(append)).toEqual(first);
    const shown = await run(['show', 'workspace:/命令.canvas', 'c1']);
    expect(shown.exitCode).toBe(0); expect(shown.stdout.match(/只追加一次/g)).toHaveLength(1);
    expect((await run([...append, '--approved'])).exitCode).not.toBe(0);
    const wrong = await executeCanvasCliCommand({ kind: 'read', path: 'workspace:/命令.canvas' }, { ...context, projectId: 'other' }, root, services).catch(error => error);
    expect(wrong).toMatchObject({ code: 'document_missing' });
  } finally { await computation.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('reads standalone queries from a genuinely read-only connection without creating runtime or migration writes', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const path = await import('node:path');
  const { readCanvasStandalone } = await import('@plugin/canvas/backend-test-support');
  const directory = await mkdtemp(path.join(tmpdir(), 'canvas-readonly-')); const file = path.join(directory, 'workspace.sqlite');
  const id = runtime.create({ projectId, parentId: null, name: '只读.canvas' });
  runtime.commit({ documentId: id, viewId: 'view', requestId: 'readonly-source', operations: [text('可读不可写')] });
  await db.backup(file);
  const reader = new Database(file, { readonly: true, fileMustExist: true });
  try {
    expect(() => reader.prepare('DELETE FROM canvas_elements').run()).toThrow();
    expect(readCanvasStandalone(reader, projectId, { kind: 'read', path: 'workspace:/只读.canvas' })).toMatchObject({ sequence: 1, text: expect.stringContaining('可读不可写') });
    expect(readCanvasStandalone(reader, projectId, { kind: 'check', path: 'workspace:/只读.canvas' })).toMatchObject({ sequence: 1 });
  } finally { reader.close(); await rm(directory, { recursive: true, force: true }); }
});
