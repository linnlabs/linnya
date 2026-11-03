import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { canvasPluginMigrations, createCanvasBackendPlugin, createCanvasDocumentRuntime } from '@plugin/canvas/backend-test-support';
import { createCanvasPlainTextDocument, encodeCanvasHistorySession } from '@plugin/canvas/shared';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema';
import { DOCUMENT_REFERENCE_SCHEMAS } from 'src/domains/document-references';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { createProjectLifecycle } from 'src/domains/projects';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { createDocumentImageAssetRuntime } from 'src/plugin-sdk/backend/documentImageAsset';
import { installRuntimePathRoots } from 'src/shared/runtime-paths';
import { ensureManagedImageStoreBinding } from 'src/domains/assets/features/managed-image-store-binding';
import { collectOrphanManagedImageAssets } from 'src/domains/assets/features/managed-image-maintenance';
import { listDocumentBacklinks, resolveDocumentReference } from 'src/plugin-sdk/backend/documentReferences';
import { listDocumentAssetByteFacts } from 'src/plugin-sdk/backend/documentAssetOwnership';
import { installPluginHostTestRuntime, resetPluginHostTestRuntime } from 'src/plugin-sdk/backend/testRuntime';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { platformBackendPlugin } from 'src/app-hosts/linnya/plugin-registry/builtin/platform.backend';
import { clearBackendRendererIntegrationPortForTesting, installBackendRendererIntegrationPort } from 'src/app-hosts/linnya/desktop-capabilities';

let root: string, appDataRoot: string, workspaceRoot: string, filename: string, projectId: string, caseDirectory: string;
let database: Database.Database;
let runtime: ReturnType<typeof createCanvasDocumentRuntime>;
const text = (value: string) => ({ op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument(value) });
const image = (assetId: string) => ({ op: 'addImage', width: 240, height: 120, data: { assetId, caption: '', alt: '', crop: null } });
function viewIdFor(documentId: string): string { return `view:${documentId}`; }
function commit(documentId: string, operations: readonly unknown[], viewId = viewIdFor(documentId)) {
  return runtime.commit({ documentId, viewId, requestId: randomUUID(), operations });
}
function checkpoint(documentId: string) { runtime.versions.checkpoint({ documentId, reason: 'close' }); }
async function restore(documentId: string, versionId: string) {
  const current = (await runtime.history.list(documentId))[0];
  if (!current) throw new Error('Missing current version');
  return runtime.history.restore({ documentId, versionId, expectedCurrentVersionId: current.versionId, clientSessionId: encodeCanvasHistorySession(viewIdFor(documentId), randomUUID()) });
}
function createCanvas(name: string) { const id = runtime.create({ projectId, parentId: null, name }); runtime.read(id, projectId, viewIdFor(id)); return id; }
function images() { ensureManagedImageStoreBinding({ db: database }); return createDocumentImageAssetRuntime(database); }

async function png(red: number) { return sharp({ create: { width: 16, height: 9, channels: 4, background: { r: red, g: 70, b: 120, alpha: 1 } } }).png().toBuffer(); }
async function latest(documentId: string) { const row = (await runtime.history.list(documentId))[0]; if (!row) throw new Error('Missing version'); return row; }

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'canvas-host-versions-'));
  appDataRoot = path.join(root, 'app-data'); workspaceRoot = path.join(root, 'workspace');
  await Promise.all([mkdir(appDataRoot), mkdir(workspaceRoot)]);
  installRuntimePathRoots({ developmentRoot: process.cwd(), appDataRoot, workspaceRoot, workspaceRootIsCustom: true });
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(async () => {
  // 只固定业务时钟；真实fs/解码与维护timer仍使用实际调度，不读取任何用户数据目录。
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  caseDirectory = await mkdtemp(path.join(root, 'case-')); filename = path.join(caseDirectory, 'workspace.sqlite');
  database = new Database(filename); database.pragma('foreign_keys=ON');
  for (const ddl of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS, ...CONVERSATION_SCHEMAS, ...ASSET_LEDGER_SCHEMAS]) database.exec(ddl);
  for (const migration of canvasPluginMigrations) migration.up(database);
  installPluginHostTestRuntime({ installedPluginIds: ['platform', 'canvas'], enabledPluginIds: ['platform', 'canvas'] });
  backendPluginRegistry.register(platformBackendPlugin); backendPluginRegistry.register(createCanvasBackendPlugin(), { allowPluginCli: true });
  installBackendRendererIntegrationPort({ connectModelCatalogUpdates: async () => () => undefined,
    publishIngestionStatus: vi.fn(), queueJobPresentationPublisher: { publishProgress: vi.fn(), publishCompletion: vi.fn(), publishFailure: vi.fn() },
    publishKnowledgeGraphProgress: vi.fn(), publishTranscriptionProgress: vi.fn(), publishWorkspaceMutation: vi.fn(), publishPluginRendererPush: vi.fn(), publishTodosChanged: vi.fn(), publishModelsChanged: vi.fn(), publishPluginsChanged: vi.fn(),
  });
  projectId = createProjectLifecycle(database).create({ name: '历史集成' });
  runtime = createCanvasDocumentRuntime(database);
});
afterEach(async () => {
  runtime.dispose(); await new Promise(resolve => setTimeout(resolve, 0));
  backendPluginRegistry.clear(); resetPluginHostTestRuntime(); clearBackendRendererIntegrationPortForTesting();
  database.close(); vi.useRealTimers(); await rm(caseDirectory, { recursive: true, force: true });
});

it('preserves the dirty live version before restore and makes the restore one undoable current-view action', async () => {
  const id = createCanvas('未检查点.canvas'); commit(id, [text('版本一')]); checkpoint(id); const target = await latest(id);
  commit(id, [{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('尚未检查点的新正文') } } }]);
  const live = await latest(id);
  await restore(id, target.versionId);
  expect((await runtime.history.list(id)).map(row => row.versionId)).toContain(live.versionId);
  expect(JSON.stringify((await runtime.history.preview(id, live.versionId)).elements)).toContain('尚未检查点的新正文');
  expect((await latest(id)).restoredFrom).toEqual({ versionId: target.versionId, createdAt: target.createdAt });
  runtime.undo({ documentId: id, viewId: viewIdFor(id), requestId: 'undo-restore', direction: 'undo' });
  expect(runtime.project(id)).toContain('尚未检查点的新正文');
  runtime.undo({ documentId: id, viewId: viewIdFor(id), requestId: 'redo-restore', direction: 'redo' }); expect(runtime.project(id)).toContain('版本一');
});

it('keeps copied managed image bytes after the source canvas is removed, restarts, restores and replays undo/redo', async () => {
  const source = createCanvas('图片来源.canvas'), destination = createCanvas('复制目标.canvas');
  const bytes = await png(20), sourceFile = path.join(root, 'source.png'); await writeFile(sourceFile, bytes);
  const asset = await images().adoptLocalImage({ documentId: source, sourcePath: sourceFile, usageHint: 'canvas:source' });
  commit(source, [image(asset.assetId)]); commit(destination, [image(asset.assetId)]); checkpoint(destination); const target = await latest(destination);
  commit(destination, [{ op: 'delete', id: 'c1' }]); checkpoint(destination);
  runtime.close(source, viewIdFor(source)); new WorkspaceService(database).deleteNode(source);
  // 模拟回收站永久移除的FK级联，证明目标文档拥有独立归属，而非依赖源文档残留关系。
  database.prepare('DELETE FROM workspace_nodes WHERE id = ?').run(source); await rm(sourceFile);
  runtime.dispose(); database.close(); database = new Database(filename); database.pragma('foreign_keys=ON'); runtime = createCanvasDocumentRuntime(database);
  runtime.read(destination, projectId, viewIdFor(destination));
  const { storeId } = ensureManagedImageStoreBinding({ db: database });
  await collectOrphanManagedImageAssets({ db: database, appDataRoot, workspaceRoot, storeId, createdBeforeMs: Date.now() + 1, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  await restore(destination, target.versionId);
  expect(await images().readOwnedImage({ documentId: destination, assetId: asset.assetId })).toMatchObject({ dataUri: `data:image/png;base64,${bytes.toString('base64')}` });
  runtime.undo({ documentId: destination, viewId: viewIdFor(destination), requestId: 'undo-image-restore', direction: 'undo' }); expect(runtime.read(destination).elements).toEqual([]);
  runtime.undo({ documentId: destination, viewId: viewIdFor(destination), requestId: 'redo-image-restore', direction: 'redo' }); expect(runtime.read(destination).elements[0]).toMatchObject({ data: { assetId: asset.assetId } });
  expect(await images().readOwnedImage({ documentId: destination, assetId: asset.assetId })).toMatchObject({ sha256: asset.sha256 });
});

it('rolls failed content admission and failed history ownership release back while leaving a shared owner readable', async () => {
  const id = createCanvas('释放.canvas'), shared = createCanvas('共享.canvas');
  const old = await images().prepareImageBytes({ documentId: id, bytes: await png(40) });
  const fresh = await images().prepareImageBytes({ documentId: id, bytes: await png(80) });
  const before = runtime.read(id), beforeVersions = await runtime.history.list(id);
  expect(() => commit(id, [image(old.assetId), { op: 'addDocument', width: 240, height: 120, data: { documentId: 'missing' } }])).toThrow();
  expect(runtime.read(id)).toEqual(before); expect(await runtime.history.list(id)).toEqual(beforeVersions);
  expect(() => listDocumentAssetByteFacts({ database, documentId: id, assetIds: [old.assetId] })).toThrow();
  commit(id, [image(old.assetId)]); checkpoint(id); const oldVersion = await latest(id); commit(shared, [image(old.assetId)]); checkpoint(shared);
  for (let index = 0; index < 7; index++) {
    const current = runtime.read(id).elements[0];
    commit(id, [{ op: 'update', id: 'c1', baseRevision: current.revision, patch: { data: { assetId: fresh.assetId, caption: `新图${index}`, alt: '', crop: null } } }]); checkpoint(id);
  }
  const beforeRestore = runtime.read(id), beforeRestoreVersions = await runtime.history.list(id);
  database.prepare(`CREATE TRIGGER fail_canvas_image_admission BEFORE INSERT ON document_asset_links WHEN NEW.document_node_id = '${id}' AND NEW.asset_id = '${old.assetId}' BEGIN SELECT RAISE(ABORT, 'asset admission failed'); END`).run();
  try {
    await expect(async () => restore(id, oldVersion.versionId)).rejects.toThrow();
    expect(runtime.read(id)).toEqual(beforeRestore); expect(await runtime.history.list(id)).toEqual(beforeRestoreVersions);
  } finally { database.exec('DROP TRIGGER fail_canvas_image_admission'); }
  runtime.close(id, viewIdFor(id)); const retained = await runtime.history.list(id);
  database.prepare(`CREATE TRIGGER fail_canvas_release BEFORE DELETE ON document_asset_links WHEN OLD.document_node_id = '${id}' AND OLD.asset_id = '${old.assetId}' BEGIN SELECT RAISE(ABORT, 'ownership release failed'); END`).run();
  try {
    expect(() => runtime.versions.compact(id)).toThrow('ownership release failed');
    expect(await runtime.history.list(id)).toEqual(retained);
    expect(await images().readOwnedImage({ documentId: id, assetId: old.assetId })).toMatchObject({ sha256: old.sha256 });
  } finally { database.exec('DROP TRIGGER fail_canvas_release'); }
  runtime.versions.compact(id);
  expect(() => listDocumentAssetByteFacts({ database, documentId: id, assetIds: [old.assetId] })).toThrow();
  expect(await images().readOwnedImage({ documentId: shared, assetId: old.assetId })).toMatchObject({ sha256: old.sha256 });
  expect(await images().readOwnedImage({ documentId: id, assetId: fresh.assetId })).toMatchObject({ sha256: fresh.sha256 });
});

it('restores stable historical tags across project moves and reused names without exposing or rebinding the old target', async () => {
  const workspace = new WorkspaceService(database), target = workspace.createNode({ projectId, parentId: null, type: 'document', name: '同名资料' });
  const id = createCanvas('身份.canvas'), referenceId = randomUUID();
  commit(id, [{ op: 'addText', width: 240, height: 120, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'documentReference', attrs: { documentId: target.id, referenceId } }] }] } }]);
  checkpoint(id); const targetVersion = await latest(id);
  commit(id, [{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('移除引用') } } }]);
  const otherProject = createProjectLifecycle(database).create({ name: '其他项目' }); database.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(otherProject, target.id);
  const replacement = workspace.createNode({ projectId, parentId: null, type: 'document', name: '同名资料' });
  await restore(id, targetVersion.versionId);
  expect(JSON.stringify(runtime.read(id).elements)).toContain(target.id); expect(JSON.stringify(runtime.read(id).elements)).not.toContain(replacement.id);
  expect(resolveDocumentReference(database, { sourceDocumentId: id, targetDocumentId: target.id })).toMatchObject({ status: 'outside_project', title: null });
  expect(listDocumentBacklinks(database, replacement.id)).toEqual([]); expect(runtime.project(id)).not.toContain(target.id); expect(runtime.project(id)).not.toContain('同名资料');
  runtime.undo({ documentId: id, viewId: viewIdFor(id), requestId: 'undo-reference', direction: 'undo' }); expect(runtime.project(id)).toContain('移除引用');
  runtime.undo({ documentId: id, viewId: viewIdFor(id), requestId: 'redo-reference', direction: 'redo' });
  expect(resolveDocumentReference(database, { sourceDocumentId: id, targetDocumentId: target.id }).status).toBe('outside_project');
  workspace.deleteNode(target.id);
  commit(id, [{ op: 'update', id: 'c1', baseRevision: runtime.read(id).elements[0].revision, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('再次移除') } } }]);
  await restore(id, targetVersion.versionId);
  expect(resolveDocumentReference(database, { sourceDocumentId: id, targetDocumentId: target.id })).toMatchObject({ status: 'deleted', title: null });
});

it('does not let an open Agent group withdraw past a user restore or accept its old card revision', async () => {
  const id = createCanvas('组边界.canvas'); commit(id, [text('用户正文')]); checkpoint(id); const target = await latest(id);
  const actor = { projectId, viewId: 'agent', source: { kind: 'agent' as const, conversationId: 'chat', runId: 'run' } };
  runtime.editing.commitAgent({ actor, now: Date.now(), request: { documentId: id, requestId: 'agent-red', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red' } }] } });
  const group = runtime.editing.listGroups(id, Date.now())[0]; if (!group) throw new Error('Missing Agent group');
  await restore(id, target.versionId); const afterRestore = runtime.read(id);
  const withdrawal = runtime.editing.withdraw({ documentId: id, viewId: viewIdFor(id), groupId: group.id, requestId: 'withdraw-after-restore' }, Date.now());
  expect(withdrawal.commit.results.every(result => result.status === 'skipped')).toBe(true); expect(runtime.read(id)).toEqual(afterRestore);
  const stale = runtime.editing.commitAgent({ actor, now: Date.now(), request: { documentId: id, requestId: 'old-revision', operations: [{ op: 'update', id: 'c1', baseRevision: 2, patch: { color: 'purple' } }] } });
  expect(stale).toMatchObject({ kind: 'committed', commit: { results: [{ status: 'skipped', reason: 'stale_field' }] } });
  runtime.undo({ documentId: id, viewId: viewIdFor(id), requestId: 'undo-after-skipped-withdrawal', direction: 'undo' }); expect(runtime.read(id).elements[0]).toMatchObject({ color: 'red' });
  runtime.undo({ documentId: id, viewId: viewIdFor(id), requestId: 'redo-after-skipped-withdrawal', direction: 'redo' }); expect(runtime.read(id).elements[0]).toMatchObject({ color: 'white' });
});
