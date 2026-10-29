import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMarkdownDocumentStore } from 'src/app-hosts/linnya/application/markdown-image-assets';
import type { MarkdownDocumentService } from 'src/domains/markdown';
import { createProjectLifecycle } from 'src/domains/projects';
import { Logger } from '../../../../shared/logger';
import { DatabaseService } from '../../database';
import { WorkspaceService } from '../workspace';
import { runWorkspaceMaintenanceOnce } from '../workspace-maintenance';

let database: DatabaseService;
let workspace: WorkspaceService;
let store: MarkdownDocumentService;
let projectId: string;

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  store = createMarkdownDocumentStore(database.getDb());
  projectId = createProjectLifecycle(database.getDb()).create({ name: '启动维护' });
});

afterEach(() => {
  vi.restoreAllMocks();
  database.close();
});

function paragraphDocument(rootBlockIds: readonly string[]): Record<string, unknown> {
  return {
    type: 'doc',
    content: rootBlockIds.map(rootId => ({
      type: 'rootBlock',
      attrs: { id: rootId },
      content: [{
        type: 'baseBlock',
        attrs: { id: `block-${rootId.slice(5)}`, blockType: 'base' },
        content: [{ type: 'text', text: '正文' }],
      }],
    })),
  };
}

function createMarkdownDocument(name: string, rootBlockIds: readonly string[]): string {
  const documentId = workspace.createNode({ type: 'document', name, projectId }).id;
  store.createDocument(documentId, paragraphDocument(rootBlockIds));
  return documentId;
}

/** 闸门之前运行的旧 Backend 会把 linnya-chart 围栏存成普通代码块；现行保存入口会拒绝，只能直接写版本行。 */
function createLegacyChartDocument(name: string): string {
  const documentId = workspace.createNode({ type: 'document', name, projectId }).id;
  const legacyContent = {
    type: 'doc',
    content: [{
      type: 'rootBlock',
      attrs: { id: 'root-legacy01' },
      content: [{
        type: 'codeBlock',
        attrs: { id: 'block-legacy01', blockType: 'code', language: 'linnya-chart' },
        content: [{ type: 'text', text: '{"chartType":"bar","categories":["a"],"series":[{"name":"s","values":[1]}]}' }],
      }],
    }],
  };
  database.getDb().prepare(`
    INSERT INTO document_versions (id, node_id, version_number, content_json, char_count, created_at)
    VALUES (?, ?, 1, ?, 0, 1)
  `).run(`version-${documentId}`, documentId, JSON.stringify(legacyContent));
  return documentId;
}

/** 指向已删除块的旧提议只能来自历史写入；现行 setPendingRevision 会拒绝不存在的目标块。 */
function insertOrphanPending(documentId: string, targetBlockId: string): void {
  database.getDb().prepare(`
    INSERT INTO markdown_block_pending_revisions (
      id, document_node_id, target_block_id, new_markdown, source, operation, meta_json, created_at
    ) VALUES (?, ?, ?, '旧提议', 'ai', 'update', NULL, 1)
  `).run(`pending-${documentId}-${targetBlockId}`, documentId, targetBlockId);
}

function pendingTargets(documentId: string): string[] {
  return database.getDb()
    .prepare<[string], { target_block_id: string }>(
      'SELECT target_block_id FROM markdown_block_pending_revisions WHERE document_node_id = ? ORDER BY target_block_id'
    )
    .all(documentId)
    .map(row => row.target_block_id);
}

describe('runWorkspaceMaintenanceOnce', () => {
  it('只复查挂有卫星数据的未删除文档，并只为有删除或失败的文档记录日志', async () => {
    const info = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const clean = createMarkdownDocument('干净文档', ['root-clean001']);
    store.setPendingRevision(clean, 'root-clean001', '保留的提议');
    const orphaned = createMarkdownDocument('有幽灵提议的文档', ['root-live0001']);
    store.setPendingRevision(orphaned, 'root-live0001', '保留的提议');
    insertOrphanPending(orphaned, 'root-gone0001');
    // 没有卫星数据：维护不读取正文，因此旧格式也不会在每次启动时报失败。
    createLegacyChartDocument('旧图表文档');
    const unreadable = createLegacyChartDocument('带提议的旧图表文档');
    insertOrphanPending(unreadable, 'root-gone0002');
    const trashed = createMarkdownDocument('已删除文档', ['root-trash001']);
    insertOrphanPending(trashed, 'root-gone0003');
    workspace.deleteNode(trashed);

    await runWorkspaceMaintenanceOnce(database);

    expect(pendingTargets(clean)).toEqual(['root-clean001']);
    expect(pendingTargets(orphaned)).toEqual(['root-live0001']);
    expect(pendingTargets(unreadable)).toEqual(['root-gone0002']);
    expect(pendingTargets(trashed)).toEqual(['root-gone0003']);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      `清理文档失败: documentId=${unreadable}, err=codeBlock language "linnya-chart" is reserved for chartBlock`,
    ]);
    const messages = info.mock.calls.map(([message]) => message);
    expect(messages.filter(message => message.startsWith('文档清理:'))).toEqual([
      `文档清理: documentId=${orphaned}, pending=1, blockVersions=0`,
    ]);
    expect(messages.filter(message => message.includes('幽灵块清理完成'))).toEqual([
      expect.stringContaining('checked=3, cleaned=1, failed=1, removed(pending=1, blockVersions=0)'),
    ]);
  });

  it('逐篇让出事件循环，维护期间的回环请求不必等待整轮清理结束', async () => {
    vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    for (let index = 0; index < 200; index += 1) {
      const documentId = createMarkdownDocument(`文档 ${index}`, [`root-live${index}`]);
      insertOrphanPending(documentId, `root-gone${index}`);
    }
    const countOrphans = () =>
      database.getDb()
        .prepare<[], { total: number }>("SELECT count(*) AS total FROM markdown_block_pending_revisions WHERE target_block_id LIKE 'root-gone%'")
        .get()?.total;
    let orphansWhenServed: number | undefined;
    const server = http.createServer((_request, response) => {
      orphansWhenServed = countOrphans();
      response.end('ok');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('loopback server has no port');

    try {
      const maintenance = runWorkspaceMaintenanceOnce(database);
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      await response.text();
      await maintenance;
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }

    expect(orphansWhenServed).toBeGreaterThan(0);
    expect(countOrphans()).toBe(0);
  });
});
