import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentPreviewRequest, DocumentPreviewResult, DocumentPreviewType } from '@app/schemas';
import { readCanvasResources } from '@plugin/canvas/backend-test-support';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { DOCUMENT_REFERENCE_SCHEMAS } from 'src/domains/document-references';
import { createProjectLifecycle } from 'src/domains/projects';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
const preview = vi.hoisted(() => ({
  read: vi.fn<(input: DocumentPreviewRequest) => Promise<DocumentPreviewResult>>(),
  types: vi.fn<() => readonly DocumentPreviewType[]>(),
}));
vi.mock('@plugin/backend/documentPreview', () => ({ createDocumentPreviewReader: () => ({ read: preview.read }), listDocumentPreviewTypes: preview.types }));
vi.mock('@plugin/backend/documentImageAsset', () => ({ createDocumentImageAssetRuntime: () => ({ readOwnedImage: vi.fn() }) }));
let db: Database.Database, projectId: string, sourceId: string, targetId: string;
beforeEach(() => {
  db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  for (const ddl of [...CORE_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS]) db.exec(ddl);
  projectId = createProjectLifecycle(db).create({ name: '资源读取' });
  const workspace = new WorkspaceService(db);
  sourceId = workspace.createNode({ projectId, name: '画布.canvas', type: 'canvas' }).id;
  targetId = workspace.createNode({ projectId, name: '来源文档', type: 'source-type' }).id;
  preview.types.mockReset().mockReturnValue([{ nodeType: 'source-type', label: '来源类型', pluginId: 'source-plugin', enabled: true, hasPreview: true }]);
  preview.read.mockReset().mockImplementation(async input => ({ documentId: input.documentId, title: '来源文档', nodeType: 'source-type', status: 'ready', content: { revisionKey: 'v1', summary: '没有封面也保留授权摘要' } }));
});
afterEach(() => db.close());
const read = () => readCanvasResources({ database: db, documentId: sourceId, documentIds: [targetId], assetIds: [], covers: true, signal: new AbortController().signal });
it('真实Workspace身份投影保留无封面摘要与preview状态，不要求先生成图片', async () => {
  const result = await read();
  expect(result.documents[targetId]).toMatchObject({ title: '来源文档', status: 'available', previewStatus: 'ready', summary: '没有封面也保留授权摘要' });
});
it('停用后只保留正式文本快照，不把旧ready封面或摘要当成可预览内容', async () => {
  preview.types.mockReturnValue([{ nodeType: 'source-type', label: '来源类型', pluginId: 'source-plugin', enabled: false, hasPreview: false }]);
  preview.read.mockImplementationOnce(async input => ({ documentId: input.documentId, title: '来源文档', nodeType: 'source-type', status: 'plugin_unavailable', content: { revisionKey: 'text-snapshot', summary: '停用后的正式快照' } }));
  expect((await read()).documents[targetId]).toMatchObject({ status: 'plugin_unavailable', previewStatus: 'plugin_unavailable', summary: '停用后的正式快照' });
  preview.types.mockReturnValueOnce([{ nodeType: 'source-type', label: '来源类型', pluginId: 'source-plugin', enabled: true, hasPreview: true }]);
  const late = (await read()).documents[targetId];
  expect(late.status).toBe('plugin_unavailable'); expect(late.summary).toBeUndefined(); expect(late.image).toBeUndefined();
});
it('封面等待期间目标移出项目，最终资源中没有旧标题、摘要或图片', async () => {
  const other = createProjectLifecycle(db).create({ name: '其他项目' });
  preview.read.mockImplementationOnce(async input => {
    db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(other, targetId);
    return { documentId: input.documentId, title: '旧标题', nodeType: 'source-type', status: 'ready', content: { revisionKey: 'v1', summary: '不得出现', image: { dataUri: 'data:image/png;base64,YWJj', widthPx: 1, heightPx: 1 } } };
  });
  const result = (await read()).documents[targetId];
  expect(result).toEqual({ title: '文档当前不可访问', status: 'outside_project', previewStatus: 'outside_project' });
});
