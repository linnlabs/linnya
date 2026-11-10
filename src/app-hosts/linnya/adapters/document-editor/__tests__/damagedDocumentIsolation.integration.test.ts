import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectLifecycle } from 'src/domains/projects';
import { MarkdownDocumentService, type MarkdownDocJson } from 'src/domains/markdown';
import { DatabaseService } from '../../../../../electron-main/services/database';
import { WorkspaceService } from '../../../../../electron-main/services/workspace/workspace';
import { readWorkspaceEditorDocument } from '../../../../../features/workspace/document-editor/orchestration/readWorkspaceEditorDocument';
import { writeWorkspaceEditorDocument } from '../../../../../features/workspace/document-editor/orchestration/writeWorkspaceEditorDocument';
import { transferWorkspaceNode } from '../../../../../features/workspace/node-transfer/orchestration/transferWorkspaceNode';
import { createWorkspaceDocumentEditorProviderResolver } from '../createWorkspaceDocumentEditorProviderResolver';

// 坏文档全部在临时目录的真实数据库里现场写出，测完删除；不读写任何工作目录的 _dev_data。
let root: string;
let database: DatabaseService;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'linnya-damaged-documents-'));
  database = new DatabaseService(path.join(root, 'workspace.sqlite'));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

function paragraph(id: string, text: string): MarkdownDocJson {
  return {
    type: 'doc',
    content: [{
      type: 'rootBlock',
      attrs: { id: `root-${id}` },
      content: [{ type: 'baseBlock', attrs: { id: `base-${id}` }, content: [{ type: 'text', text }] }],
    }],
  };
}

function withMissingImage(): MarkdownDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: 'root-text' },
        content: [{ type: 'baseBlock', attrs: { id: 'base-text' }, content: [{ type: 'text', text: '图片下面的正文' }] }],
      },
      {
        type: 'rootBlock',
        attrs: { id: 'root-image' },
        // 引用的图片文件不存在：只影响这张图的显示。
        content: [{ type: 'imageBlock', attrs: { id: 'image-missing', src: 'media://load/doc-image/missing.png' } }],
      },
    ],
  };
}

function overwriteLatestContent(documentId: string, contentJson: string): void {
  database.getDb().prepare(`
    UPDATE document_versions SET content_json = ?
    WHERE node_id = ? AND version_number = (
      SELECT MAX(version_number) FROM document_versions WHERE node_id = ?
    )
  `).run(contentJson, documentId, documentId);
}

function setUpFixtureProject() {
  const db = database.getDb();
  const projects = createProjectLifecycle(db);
  const projectId = projects.create({ name: '夹具项目' });
  const otherProjectId = projects.create({ name: '另一个项目' });
  const workspace = new WorkspaceService(db);
  const store = new MarkdownDocumentService(db);
  const create = (name: string, content: MarkdownDocJson): string => {
    const id = workspace.createDocument(projectId, name, null, 'document');
    store.createDocument(id, content);
    return id;
  };
  const normal = create('正常.md', paragraph('normal', '正常正文'));
  const unreadable = create('正文损坏.md', paragraph('unreadable', '会被写坏'));
  const invalidFormat = create('结构不合法.md', paragraph('invalid', '会被写坏'));
  const missingImage = create('缺图.md', withMissingImage());
  overwriteLatestContent(unreadable, '{"type":"doc","content":[{"type":"rootBl');
  overwriteLatestContent(invalidFormat, JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));
  const resolveProvider = createWorkspaceDocumentEditorProviderResolver({
    db,
    mutationPublisher: { publish() {} },
  });
  const read = (documentId: string) => readWorkspaceEditorDocument({
    documentId,
    workspaceService: workspace,
    resolveProvider,
  });
  return {
    db, workspace, resolveProvider, read, projectId, otherProjectId,
    normal, unreadable, invalidFormat, missingImage,
  };
}

describe('单篇坏文档不影响目录和其他文档', () => {
  it('目录列出全部文档，包括读不出正文的两篇', () => {
    const { workspace, projectId } = setUpFixtureProject();
    expect(workspace.getChildNodes(null, projectId).map(node => node.name).sort()).toEqual(
      ['正常.md', '正文损坏.md', '结构不合法.md', '缺图.md'].sort(),
    );
  });

  it('坏的两篇打开时分别说明是读取错误还是格式错误，不返回空文档', async () => {
    const { read, unreadable, invalidFormat } = setUpFixtureProject();
    await expect(read(unreadable)).rejects.toMatchObject({
      name: 'MarkdownDocumentContentError',
      failure: 'unreadable',
      message: expect.stringMatching(/^这篇文档的正文已损坏，无法读取（.+）$/),
    });
    await expect(read(invalidFormat)).rejects.toMatchObject({
      name: 'MarkdownDocumentContentError',
      failure: 'invalid_format',
      message: expect.stringMatching(/^这篇文档的格式不正确，无法打开（.+）$/),
    });
  });

  it('缺图的那篇正文照常可读，图片块保留原引用', async () => {
    const { read, missingImage } = setUpFixtureProject();
    const result = await read(missingImage);
    expect(JSON.stringify(result.content)).toContain('图片下面的正文');
    expect(JSON.stringify(result.content)).toContain('media://load/doc-image/missing.png');
  });

  it('正常文档照常打开、编辑、跨项目移动', async () => {
    const {
      db, workspace, resolveProvider, read, normal, otherProjectId, projectId,
    } = setUpFixtureProject();
    expect(JSON.stringify((await read(normal)).content)).toContain('正常正文');

    await writeWorkspaceEditorDocument({
      documentId: normal,
      workspaceService: workspace,
      resolveProvider,
      content: paragraph('normal', '编辑后的正文'),
    });
    expect(JSON.stringify((await read(normal)).content)).toContain('编辑后的正文');

    transferWorkspaceNode({ db, nodeId: normal, targetProjectId: otherProjectId });
    expect(workspace.getChildNodes(null, otherProjectId).map(node => node.name)).toEqual(['正常.md']);
    expect(workspace.getChildNodes(null, projectId).map(node => node.name)).not.toContain('正常.md');
    expect(JSON.stringify((await read(normal)).content)).toContain('编辑后的正文');
  });
});
