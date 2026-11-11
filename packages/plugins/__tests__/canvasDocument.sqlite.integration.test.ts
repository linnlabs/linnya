import { JsonValueSchema } from '@app/schemas';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canvasPluginMigrations, createCanvasDocumentRuntime, createCanvasBackendPlugin, readCanvasSelectionContext } from '@plugin/canvas/backend-test-support';
import { CanvasAgentReceiptQueryResultSchema, createCanvasPlainTextDocument, encodeCanvasHistorySession, CanvasCommitResultSchema, CanvasLayoutComputationSchema } from '@plugin/canvas/shared';
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
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';

let db: Database.Database;
let runtime: ReturnType<typeof createCanvasDocumentRuntime>;
let projectId: string;
const push = vi.fn();
const text = (value: string) => ({ op: 'addText', content: createCanvasPlainTextDocument(value), width: 240, height: 120 });
// 手工驱动Renderer入口时也先完成read注册；关闭/崩溃后的旧view不能靠写入偷偷重建。
function commitInView(input: { documentId: string; viewId: string; requestId: string; operations: readonly unknown[] }) {
  runtime.read(input.documentId, projectId, input.viewId);
  return runtime.commit(input);
}
beforeEach(() => {
  db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  for (const ddl of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS, ...CONVERSATION_SCHEMAS, ...ASSET_LEDGER_SCHEMAS]) db.exec(ddl);
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
  commitInView({ documentId: id, viewId: 'view', requestId: 'add', operations: [text('旧正文')] });
  runtime.close(id, 'view');
  const first = readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], conversationId: 'chat' });
  commitInView({ documentId: id, viewId: 'another', requestId: 'edit', operations: [{ op: 'update', id: 'c1', baseRevision: 1,
    patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('最新正文') } } }] });
  const refreshed = readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], conversationId: 'chat' });
  expect(refreshed.sequence).toBe(2); expect(refreshed.text).toContain('最新正文');
  expect(first.text).toContain('旧正文'); expect(first.sequence).toBe(1);
  expect(() => readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], projectId: 'other-project' })).toThrow('其他项目');
  expect(() => readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], projectId: null })).toThrow('项目');
  db.prepare('UPDATE conversations SET project_id = NULL WHERE conversation_id = ?').run('chat');
  expect(() => readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'], conversationId: 'chat' })).toThrow('项目');
});
it('sends only the committed deletion notice for an empty selection and rejects copying it', async () => {
  const id = runtime.create({ projectId, parentId: null, name: '删除.canvas' });
  commitInView({ documentId: id, viewId: 'view', requestId: 'add', operations: [text('已选择')] });
  commitInView({ documentId: id, viewId: 'view', requestId: 'delete', operations: [{ op: 'delete', id: 'c1' }] });
  const context = readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'] });
  expect(context).toMatchObject({ sequence: 2, elementIds: [] });
  expect(context.text).toContain('已全部删除'); expect(context.text).not.toContain('已选择');
  const { readCanvasClipboard } = await import('@plugin/canvas/backend-test-support');
  expect(() => readCanvasClipboard(db, { documentId: id, elementIds: ['c1'] })).toThrow('没有可复制');
  runtime.undo({ documentId: id, viewId: 'view', requestId: 'undo-selected-deletion', direction: 'undo' });
  expect(readCanvasSelectionContext(db, { documentId: id, elementIds: ['c1'] }).text).toContain('已选择');
});
it('refreshes a partially deleted selection using only remaining committed cards', () => {
  const id = runtime.create({ projectId, parentId: null, name: '部分.canvas' });
  commitInView({ documentId: id, viewId: 'view', requestId: 'add', operations: [text('已删除'), text('仍存在')] });
  commitInView({ documentId: id, viewId: 'view', requestId: 'delete', operations: [{ op: 'delete', id: 'c1' }] });
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
  commitInView({ documentId: id, viewId: 'view', requestId: 'first', operations: [text('中文正文')] });
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ channel: 'canvas:changed', payload: expect.objectContaining({ documentId: id, sequence: 1, sourceKind: 'user', changedElementCount: 1, committedAt: expect.any(Number) }) }));
  runtime.close(id, 'view');
  expect(runtime.read(id).elements).toHaveLength(1);
  expect(runtime.project(id)).toContain('中文正文');
  expect(db.prepare('SELECT text FROM workspace_node_text_snapshots WHERE node_id = ?').get(id)).toEqual({ text: '[c1] 中文正文' });
  const workspace = new WorkspaceService(db);
  workspace.renameNode(id, '重命名.canvas');
  expect(readWorkspaceDocumentLocation(db, id)?.path).toContain('重命名.canvas');
});

it('releases the actual Host view on Renderer loss and rejects writes that try to recreate it', () => {
  const id = runtime.create({ projectId, parentId: null, name: '重载.canvas' });
  const session = new AbortController();
  runtime.read(id, projectId, 'old-view', { rendererSessionId: 'old-window', signal: session.signal });
  runtime.commit({ documentId: id, viewId: 'old-view', requestId: 'before-reload', operations: [text('已保存')] });
  runtime.protect({ documentId: id, viewId: 'old-view', claims: [{ elementId: 'c1', fields: ['data'] }] });
  expect(runtime.editing.status(id, 'old-view').canUndo).toBe(true);
  session.abort();
  expect(runtime.editing.status(id, 'old-view')).toEqual({ canUndo: false, canRedo: false });
  expect(db.prepare('SELECT count(*) AS n FROM canvas_editing_claims WHERE view_id = ?').get('old-view')).toEqual({ n: 0 });
  expect(() => runtime.commit({ documentId: id, viewId: 'old-view', requestId: 'late-write', operations: [text('不得重新登记')] })).toThrow('视图已关闭');
  expect(runtime.read(id).elements).toHaveLength(1);
  runtime.read(id, projectId, 'new-view', { rendererSessionId: 'new-window', signal: new AbortController().signal });
  runtime.commit({ documentId: id, viewId: 'new-view', requestId: 'after-reload', operations: [text('重载后')] });
  expect(runtime.read(id).elements).toHaveLength(2);
});
it('keeps references atomic and hides moved targets without retargeting a reused name', () => {
  const workspace = new WorkspaceService(db);
  const target = workspace.createNode({ projectId, parentId: null, type: 'document', name: '资料' });
  const id = runtime.create({ projectId, parentId: null, name: '引用' });
  const operations = [{ op: 'addDocument', data: { documentId: target.id }, width: 240, height: 180 }];
  commitInView({ documentId: id, viewId: 'view', requestId: 'reference', operations });
  const refs = createDocumentReferenceOperations(db, { read: key => readWorkspaceDocumentIdentity(db, key) });
  expect(refs.listBacklinks(target.id)).toHaveLength(1);
  expect(() => commitInView({ documentId: id, viewId: 'view', requestId: 'bad', operations: [text('整批回滚'), { ...operations[0], data: { documentId: 'missing' } }] })).toThrow();
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
  // 正式Plugin CLI只保证冻结identity与数据能力，不能伪装完整文件工具上下文让测试误过。
  const context = { hostContext: { databaseService: { getDb: () => db } }, projectId, conversationId: 'chat', agentRunId: 'run', signal: new AbortController().signal };
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
    const beforeReceipt = runtime.read(id);
    const queriedReceipt = CanvasAgentReceiptQueryResultSchema.parse(JSON.parse((await run(['receipt', 'workspace:/命令.canvas', 'create'])).stdout));
    expect(queriedReceipt).toMatchObject({ documentId: 'workspace:/命令.canvas', receipt: { requestId: 'create', status: 'committed', commit: { documentId: 'workspace:/命令.canvas', sequence: beforeReceipt.sequence } } });
    expect(queriedReceipt.receipt?.commit?.results).toEqual(JSON.parse(created.stdout).results);
    expect(JSON.stringify(queriedReceipt)).not.toContain(id); expect(runtime.read(id)).toEqual(beforeReceipt);
    const foreignReceipt = await executeCanvasCliCommand({ kind: 'receipt', path: 'workspace:/命令.canvas', requestId: 'create' }, { ...context, conversationId: 'another-chat' }, root, services);
    expect(foreignReceipt).toMatchObject({ receipt: null });
    expect(await run(['receipt', 'workspace:/命令.canvas', 'not-created'])).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('"receipt":null') });
    const receipt = CanvasCommitResultSchema.pick({ requestId: true, sequence: true, refs: true, results: true }).strip();
    const createdValue: unknown = JSON.parse(created.stdout), retry = await run(argv);
    expect(receipt.parse(JSON.parse(retry.stdout))).toEqual(receipt.parse(createdValue));
    expect(JSON.parse(retry.stdout)).toMatchObject({ replayed: true, computation: null }); expect(measureCalls).toBe(1);
    expect(createdValue).toMatchObject({ replayed: false, computation: { origin: 'node-worker', requestId: 'create', algorithm: 'tree' } });
    const parseComputation = (value: unknown) => CanvasLayoutComputationSchema.parse(value);
    const createdEnvelope = JsonValueSchema.parse(createdValue);
    if (!createdEnvelope || typeof createdEnvelope !== 'object' || Array.isArray(createdEnvelope)) throw new Error('Expected CLI response');
    expect(parseComputation(createdEnvelope.computation).executionMs).toBeGreaterThan(0);
    const beforePreview = runtime.read(id);
    const layoutPreview = await run(['arrange', 'workspace:/命令.canvas', '--request-id', 'timing-preview', '--algorithm', 'grid', '--dry-run']);
    expect(layoutPreview.exitCode, layoutPreview.stdout).toBe(0);
    expect(JSON.parse(layoutPreview.stdout)).toMatchObject({ status: 'dry-run', replayed: false, computation: { origin: 'node-worker', requestId: 'timing-preview', sequence: beforePreview.sequence, algorithm: 'grid' } });
    expect(runtime.read(id)).toEqual(beforePreview);
    await writeFile(path.join(root, 'append.json'), JSON.stringify([{ op: 'update', id: 'c1', revision: runtime.read(id).elements.find(element => element.id === 'c1')!.revision, append: '只追加一次' }]));
    const append = ['apply', 'workspace:/命令.canvas', '--ops-file', 'append.json', '--request-id', 'append'];
    const first = await run(append); expect(first.exitCode).toBe(0);
    commitInView({ documentId: id, viewId: 'view', requestId: 'change-color', operations: [{ op: 'update', id: 'c1', baseRevision: runtime.read(id).elements.find(element => element.id === 'c1')!.revision, patch: { color: 'yellow' } }] });
    const appendReplay = await run(append); expect(receipt.parse(JSON.parse(appendReplay.stdout))).toEqual(receipt.parse(JSON.parse(first.stdout)));
    expect(JSON.parse(appendReplay.stdout)).toMatchObject({ replayed: true, computation: null });
    const shown = await run(['show', 'workspace:/命令.canvas', 'c1']);
    expect(shown.exitCode).toBe(0); expect(shown.stdout.match(/只追加一次/g)).toHaveLength(1);
    expect((await run([...append, '--approved'])).exitCode).not.toBe(0);
    const wrong = await executeCanvasCliCommand({ kind: 'read', path: 'workspace:/命令.canvas' }, { ...context, projectId: 'other' }, root, services).catch(error => error);
    expect(wrong).toMatchObject({ code: 'document_missing' });
    const workspace = new WorkspaceService(db);
    const target = workspace.createNode({ projectId, parentId: null, type: 'document', name: '项目资料.md' });
    workspace.createNode({ projectId, parentId: null, type: 'folder', name: '资料目录' });
    const outsideProject = createProjectLifecycle(db).create({ name: '其他项目资料' });
    workspace.createNode({ projectId: outsideProject, parentId: null, type: 'document', name: '仅外部.md' });
    await writeFile(path.join(root, 'document.json'), JSON.stringify([{ op: 'add', type: 'document', document: 'workspace:/项目资料.md', ref: '$source' }]));
    const documentArgs = ['apply', 'workspace:/命令.canvas', '--ops-file', 'document.json', '--request-id', 'document-card'];
    const beforeDocument = runtime.read(id);
    const dry = await run([...documentArgs, '--dry-run']); expect(dry.exitCode, dry.stdout).toBe(0); expect(dry.stdout).toContain('dry-run');
    expect(runtime.read(id)).toEqual(beforeDocument);
    const addedDocument = await run(documentArgs); expect(addedDocument.exitCode, addedDocument.stdout).toBe(0);
    expect(runtime.read(id).elements.filter(element => element.type === 'document')).toEqual([expect.objectContaining({ data: expect.objectContaining({ documentId: target.id }) })]);
    const documentReplay = await run(documentArgs); expect(receipt.parse(JSON.parse(documentReplay.stdout))).toEqual(receipt.parse(JSON.parse(addedDocument.stdout)));
    expect(JSON.parse(documentReplay.stdout)).toMatchObject({ replayed: true, computation: null });
    const beforeInvalid = runtime.read(id);
    for (const document of ['workspace:/资料目录', 'workspace:/仅外部.md']) {
      await writeFile(path.join(root, 'invalid-document.json'), JSON.stringify([{ op: 'add', text: '整批不能落盘' }, { op: 'add', type: 'document', document }]));
      const rejected = await run(['apply', 'workspace:/命令.canvas', '--ops-file', 'invalid-document.json', '--request-id', `invalid-${document}`]);
      expect(rejected.exitCode).not.toBe(0); expect(rejected.stdout).toContain('invalid_arguments'); expect(runtime.read(id)).toEqual(beforeInvalid);
    }
  } finally { await computation.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('reads standalone queries from a genuinely read-only connection without creating runtime or migration writes', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const path = await import('node:path');
  const { readCanvasStandalone } = await import('@plugin/canvas/backend-test-support');
  const directory = await mkdtemp(path.join(tmpdir(), 'canvas-readonly-')); const file = path.join(directory, 'workspace.sqlite');
  const id = runtime.create({ projectId, parentId: null, name: '只读.canvas' });
  commitInView({ documentId: id, viewId: 'view', requestId: 'readonly-source', operations: [text('可读不可写')] });
  const agent = runtime.editing.commitAgent({ request: { documentId: id, requestId: 'readonly-receipt', operations: [text('原始Agent回执')] }, actor: { projectId, viewId: 'agent', source: { kind: 'agent', conversationId: 'chat', runId: 'run' } }, now: Date.now() });
  if (agent.kind !== 'committed') throw new Error('expected committed fixture');
  await db.backup(file);
  const reader = new Database(file, { readonly: true, fileMustExist: true });
  try {
    expect(() => reader.prepare('DELETE FROM canvas_elements').run()).toThrow();
    expect(readCanvasStandalone(reader, projectId, { kind: 'read', path: 'workspace:/只读.canvas' })).toMatchObject({ sequence: 2, text: expect.stringContaining('可读不可写') });
    expect(readCanvasStandalone(reader, projectId, { kind: 'check', path: 'workspace:/只读.canvas' })).toMatchObject({ sequence: 2 });
    const receipt = CanvasAgentReceiptQueryResultSchema.parse(readCanvasStandalone(reader, projectId, { kind: 'receipt', path: 'workspace:/只读.canvas', conversationId: 'chat', requestId: 'readonly-receipt' }));
    expect(receipt.receipt?.commit).toEqual({ ...agent.commit, documentId: 'workspace:/只读.canvas' });
    expect(readCanvasStandalone(reader, projectId, { kind: 'receipt', path: 'workspace:/只读.canvas', conversationId: 'other-chat', requestId: 'readonly-receipt' })).toMatchObject({ receipt: null });
    expect(() => readCanvasStandalone(reader, 'other-project', { kind: 'receipt', path: 'workspace:/只读.canvas', conversationId: 'chat', requestId: 'readonly-receipt' })).toThrow();
  } finally { reader.close(); await rm(directory, { recursive: true, force: true }); }
});

it('holds images for durable pending approval and keeps the prior proposal when replacement admission fails', () => {
  db.prepare('INSERT INTO assets(id, uri, storage_status, created_at, size_bytes) VALUES (?, ?, ?, ?, ?)').run('pending-image', 'asset:pending-image', 'local', 1, 4096);
  const id = runtime.create({ projectId, parentId: null, name: '待确认.canvas' });
  commitInView({ documentId: id, viewId: 'view', requestId: 'user-cards', operations: Array.from({ length: 20 }, (_, index) => text(`用户 ${index}`)) });
  const actor = { projectId, viewId: 'agent', source: { kind: 'agent' as const, conversationId: 'chat', runId: 'run' } };
  const propose = (requestId: string, assetId: string) => runtime.editing.commitAgent({ actor, now: 2, request: { documentId: id, requestId,
    operations: [{ op: 'addImage', data: { assetId, caption: '', alt: '', crop: null }, width: 240, height: 120 }, ...Array.from({ length: 20 }, (_, index) => ({ op: 'delete', id: `c${index + 1}`, baseRevision: 1 }))] } });
  const pending = propose('first', 'pending-image'); expect(pending.kind).toBe('pending');
  expect(runtime.pendingAssetIds(id)).toEqual(['pending-image']);
  expect(db.prepare('SELECT asset_id FROM document_asset_links WHERE document_node_id = ?').all(id)).toEqual([{ asset_id: 'pending-image' }]);
  expect(() => propose('replacement', 'missing-image')).toThrow();
  expect(runtime.editing.listGroups(id, 3)[0].pendingApproval?.requestId).toBe('first');
  expect(runtime.read(id).elements).toHaveLength(20);
  if (pending.kind !== 'pending') throw new Error('Expected pending batch');
  runtime.editing.resolveApproval({ documentId: id, viewId: 'view', requestId: 'deny', pendingId: pending.approval.id, decision: 'deny' }, 3);
  expect(runtime.pendingAssetIds(id)).toEqual([]);
});

it('revalidates the frozen project after asynchronous read-only computation', async () => {
  const { executeCanvasCliCommand } = await import('@plugin/canvas/backend-test-support');
  const id = runtime.create({ projectId, parentId: null, name: '异步作用域.canvas' });
  commitInView({ documentId: id, viewId: 'view', requestId: 'scope-source', operations: [text('不能越界返回')] });
  const destination = createProjectLifecycle(db).create({ name: '移动目标' });
  const unused = async () => { throw new Error('Unexpected capability'); };
  const services: import('@plugin/canvas/backend-test-support').CanvasCliServices = {
    runtimeFor: () => runtime, referencesFor: () => runtime.references,
    capabilities: { measurement: { measure: unused, measureBatch: unused }, rendering: { render: unused }, computation: { layout: unused, dispose: async () => {},
      async check() {
        db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(destination, id);
        return { sequence: 1, cardCount: 1, edgeCount: 0, overlapCount: 0, crossingCount: 0, overlaps: [], crossings: [], longEdges: [], outliers: [], note: '' };
      } } },
  };
  await expect(executeCanvasCliCommand({ kind: 'check', path: 'workspace:/异步作用域.canvas' }, { hostContext: { databaseService: { getDb: () => db } },
    projectId, conversationId: 'chat', agentRunId: 'run', signal: new AbortController().signal }, '/unused', services)).rejects.toMatchObject({ code: 'outside_project' });
});

it('rejects an in-flight Agent write against a disposed runtime and accepts it only through the new instance', () => {
  const id = runtime.create({ projectId, parentId: null, name: '重新启用.canvas' });
  const oldEditing = runtime.editing;
  const actor = { projectId, viewId: 'agent', source: { kind: 'agent' as const, conversationId: 'chat', runId: 'late' } };
  const late = { actor, now: Date.now(), request: { documentId: id, requestId: 'late-write', operations: [text('旧计算结果')] } };
  runtime.dispose();
  expect(() => oldEditing.commitAgent(late)).toThrow('停用');
  expect(db.prepare('SELECT sequence FROM canvas_documents WHERE node_id = ?').get(id)).toEqual({ sequence: 0 });
  runtime = createCanvasDocumentRuntime(db);
  expect(runtime.editing.commitAgent(late)).toMatchObject({ kind: 'committed', commit: { sequence: 1 } });
  expect(runtime.read(id).elements).toHaveLength(1);
});

it('confirms a lost restoration response without applying it twice and repeats only its captured-session notification', async () => {
  const id = runtime.create({ projectId, parentId: null, name: '恢复重试.canvas' });
  runtime.read(id, projectId, 'view');
  commitInView({ documentId: id, viewId: 'view', requestId: 'restore-source', operations: [text('恢复目标')] });
  runtime.versions.checkpoint({ documentId: id, reason: 'close' });
  const target = runtime.history.list(id)[0];
  commitInView({ documentId: id, viewId: 'view', requestId: 'before-restore', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red' } }] });
  const request = { documentId: id, versionId: target.versionId, expectedCurrentVersionId: runtime.history.list(id)[0].versionId,
    clientSessionId: encodeCanvasHistorySession('view', '09e16e02-7dc9-41a7-b690-96f7a8815a45') };
  await runtime.history.restore(request);
  const restoredSequence = runtime.read(id).sequence;
  const card = runtime.read(id).elements[0];
  commitInView({ documentId: id, viewId: 'view', requestId: 'after-restore', operations: [{ op: 'update', id: 'c1', baseRevision: card.revision, patch: { color: 'green' } }] });
  const sequence = runtime.read(id).sequence;
  await runtime.history.restore(request);
  expect(runtime.read(id)).toMatchObject({ sequence, elements: [{ color: 'green' }] });
  const notifications = push.mock.calls.filter(([event]) => event.channel === 'canvas:restored');
  expect(notifications).toHaveLength(2);
  for (const [event] of notifications) expect(event.payload).toEqual({ documentId: id, clientSessionId: request.clientSessionId, sequence: restoredSequence });
  runtime.undo({ documentId: id, viewId: 'view', requestId: 'undo-after-restore', direction: 'undo' });
  runtime.undo({ documentId: id, viewId: 'view', requestId: 'undo-confirmed-restore', direction: 'undo' });
  expect(runtime.read(id).elements[0]).toMatchObject({ color: 'red' });
});

it('reports fresh Renderer arrangement computation and replays no-op receipts without pretending to recompute', async () => {
  const { createCanvasArrangementRuntime, createCanvasComputationRuntime } = await import('@plugin/canvas/backend-test-support');
  const path = await import('node:path');
  const computation = createCanvasComputationRuntime({ workerPath: path.resolve('packages/plugins/canvas/dist/backend/canvas-computation-worker.cjs') });
  const unused = async () => { throw new Error('Unexpected capability'); };
  const arrangement = createCanvasArrangementRuntime(db, runtime, { computation, measurement: { measure: unused, measureBatch: unused }, rendering: { render: unused } });
  const id = runtime.create({ projectId, parentId: null, name: '排布计时.canvas' });
  commitInView({ documentId: id, viewId: 'view', requestId: 'seed-layout', operations: [text('第一张'), text('第二张')] });
  try {
    const input = { documentId: id, viewId: 'view', requestId: 'layout-first', options: { algorithm: 'grid' }, operations: [] };
    const first = await arrangement.arrange(input);
    expect(first).toMatchObject({ replayed: false, computation: { requestId: 'layout-first', algorithm: 'grid', origin: 'node-worker' } });
    const after = runtime.read(id), noOpInput = { ...input, requestId: 'layout-noop' };
    const noOp = await arrangement.arrange(noOpInput);
    expect(noOp).toMatchObject({ replayed: false, computation: { requestId: 'layout-noop', sequence: after.sequence } });
    expect(noOp.computation?.executionMs).toBeGreaterThan(0); expect(runtime.read(id)).toEqual(after);
    const replay = await arrangement.arrange(noOpInput);
    expect(replay).toEqual({ commit: noOp.commit, diagnostics: [], computation: null, replayed: true });
    expect(runtime.read(id)).toEqual(after);
  } finally { arrangement.dispose(); await computation.dispose(); }
});
it('reports who changed what since a sequence or time, with last-modified source in read and show', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const path = await import('node:path');
  const { executeCanvasCliCommand, createCanvasPluginCli, formatCanvasCliInputError } = await import('@plugin/canvas/backend-test-support');
  const root = await mkdtemp(path.join(tmpdir(), 'canvas-changes-test-'));
  const id = runtime.create({ projectId, parentId: null, name: '改动.canvas' });
  const services: import('@plugin/canvas/backend-test-support').CanvasCliServices = { runtimeFor: () => runtime, referencesFor: () => runtime.references,
    capabilities: { computation: { async check() { throw new Error('not used'); }, async layout() { throw new Error('not used'); }, async dispose() {} } as never,
      measurement: { async measureBatch(request) { return request.cards.map(card => ({ ref: card.ref, width: card.width, height: 120 })); }, async measure(request) { return { width: request.width, height: 120 }; } },
      rendering: { async render() { throw new Error('not used'); } } } };
  const context = { hostContext: { databaseService: { getDb: () => db } }, projectId, conversationId: 'chat', agentRunId: 'run', signal: new AbortController().signal };
  const cli = createCanvasPluginCli((command, execution, directory) => executeCanvasCliCommand(command, execution, directory, services), formatCanvasCliInputError);
  const run = async (argv: string[]) => {
    const prepared = cli.prepare({ argv, invocationId: 'invocation', conversationRoot: root });
    const result = prepared.status === 'completed' ? prepared.result : await prepared.plan.execute(context);
    return { exitCode: result.exitCode, value: JSON.parse(result.stdout) };
  };
  const revision = (cardId: string) => runtime.read(id).elements.find(element => element.id === cardId)!.revision;
  try {
    commitInView({ documentId: id, viewId: 'view', requestId: 'seed', operations: [text('保留'), text('将删除')] });
    const baseline = runtime.read(id).sequence;
    commitInView({ documentId: id, viewId: 'view', requestId: 'edit', operations: [{ op: 'update', id: 'c1', baseRevision: revision('c1'), patch: { color: 'yellow', x: 40 } }, { op: 'delete', id: 'c2', baseRevision: revision('c2') }, text('先加后删')] });
    commitInView({ documentId: id, viewId: 'view', requestId: 'drop', operations: [{ op: 'delete', id: 'c3', baseRevision: revision('c3') }] });
    await writeFile(path.join(root, 'agent.json'), JSON.stringify([{ op: 'add', text: 'Agent 写的' }]));
    expect((await run(['apply', 'workspace:/改动.canvas', '--ops-file', 'agent.json', '--request-id', 'agent'])).exitCode).toBe(0);
    const since = await run(['changes', 'workspace:/改动.canvas', '--after', String(baseline)]);
    expect(since.exitCode, JSON.stringify(since.value)).toBe(0);
    expect(since.value).toMatchObject({ fromSequence: baseline, complete: true, total: { added: 1, updated: 1, removed: 1 } });
    expect(since.value.changes).toEqual([
      expect.objectContaining({ id: 'c1', change: 'updated', fields: expect.arrayContaining(['color', 'x']), by: { kind: 'user' }, text: '保留' }),
      expect.objectContaining({ id: 'c2', change: 'removed', by: { kind: 'user' }, text: '将删除' }),
      expect.objectContaining({ id: 'c4', change: 'added', by: { kind: 'agent', currentConversation: true }, text: 'Agent 写的', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) }),
    ]);
    // 范围内先加后删的 c3 不出现在净变化里；范围外已存在后被删的 c2 照常报删除。
    expect(since.value.changes.map((change: { id: string }) => change.id)).not.toContain('c3');
    const all = await run(['changes', 'workspace:/改动.canvas', '--since', '2000-01-01 00:00']);
    expect(all.value).toMatchObject({ fromSequence: 0, complete: true, total: { added: 2, updated: 0, removed: 0 } });
    const read = await run(['read', 'workspace:/改动.canvas']);
    expect(read.value.text).toMatch(/\[c1\][^\n]*最后修改：用户 \d{4}-/); expect(read.value.text).toMatch(/\[c4\][^\n]*最后修改：Agent /);
    expect((await run(['show', 'workspace:/改动.canvas', 'c4'])).value.elements[0]).toMatchObject({ updatedBy: 'agent', updatedAt: expect.any(String) });
    expect((await run(['changes', 'workspace:/改动.canvas', '--after', '999'])).value.error).toMatchObject({ code: 'invalid_sequence' });
    expect((await run(['changes', 'workspace:/改动.canvas'])).value.error).toMatchObject({ code: 'missing_argument' });
    // 模拟日志已裁剪：当前序号远超保留窗口时，早于窗口的范围必须如实标为不完整。
    db.prepare('UPDATE canvas_documents SET sequence = sequence + 600 WHERE node_id = ?').run(id);
    expect((await run(['changes', 'workspace:/改动.canvas', '--after', String(baseline)])).value).toMatchObject({ complete: false, note: expect.stringContaining('read') });
    db.prepare('UPDATE canvas_documents SET sequence = sequence - 600 WHERE node_id = ?').run(id);
  } finally { await rm(root, { recursive: true, force: true }); }
});
