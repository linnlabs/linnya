import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canvasPluginMigrations, createCanvasDocumentRuntime, createCanvasBackendPlugin } from '@plugin/canvas/backend-test-support';
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

let db: Database.Database;
let runtime: ReturnType<typeof createCanvasDocumentRuntime>;
let projectId: string;
const push = vi.fn();
const text = (value: string) => ({ op: 'addText', content: createCanvasPlainTextDocument(value), width: 240, height: 120 });
beforeEach(() => {
  db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  for (const ddl of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS]) db.exec(ddl);
  for (const migration of canvasPluginMigrations) migration.up(db);
  installPluginHostTestRuntime({ installedPluginIds: ['platform', 'canvas'], enabledPluginIds: ['platform', 'canvas'] });
  backendPluginRegistry.register(platformBackendPlugin);
  backendPluginRegistry.register(createCanvasBackendPlugin());
  push.mockClear();
  installBackendRendererIntegrationPort({ connectModelCatalogUpdates: async () => () => undefined,
    publishIngestionStatus: vi.fn(), queueJobPresentationPublisher: { publishProgress: vi.fn(), publishCompletion: vi.fn(), publishFailure: vi.fn() },
    publishKnowledgeGraphProgress: vi.fn(), publishTranscriptionProgress: vi.fn(), publishWorkspaceMutation: vi.fn(),
    publishPluginRendererPush: push, publishTodosChanged: vi.fn(), publishModelsChanged: vi.fn(), publishPluginsChanged: vi.fn(),
  });
  projectId = createProjectLifecycle(db).create({ name: '画布测试' });
  runtime = createCanvasDocumentRuntime(db);
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
