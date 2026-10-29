import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { AUDIO_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/audio.schema';
import { BLOCK_HISTORY_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { PENDING_REVISION_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { MarkdownDocumentService, MarkdownOrphanBlockDataCleaner } from 'src/domains/markdown';

function setup(): {
  readonly db: Database.Database;
  readonly service: MarkdownDocumentService;
  readonly cleaner: MarkdownOrphanBlockDataCleaner;
} {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const statement of [
    ...CORE_SCHEMAS,
    ...ASSET_LEDGER_SCHEMAS,
    ...MARKDOWN_DOCUMENT_SCHEMAS,
    ...AUDIO_BLOCK_SCHEMAS,
    ...IMAGE_BLOCK_SCHEMAS,
    ...BLOCK_HISTORY_SCHEMAS,
    ...PENDING_REVISION_SCHEMAS,
  ]) {
    db.exec(statement);
  }
  const service = new MarkdownDocumentService(db);
  return { db, service, cleaner: new MarkdownOrphanBlockDataCleaner(db, service) };
}

function createDocument(
  db: Database.Database,
  service: MarkdownDocumentService,
  documentId: string,
  rootBlockIds: readonly string[]
): void {
  db.prepare(`
    INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, icon, created_at, updated_at)
    VALUES (?, NULL, NULL, 'document', ?, NULL, 1, 1)
  `).run(documentId, documentId);
  service.createDocument(documentId, {
    type: 'doc',
    content: rootBlockIds.map((rootId, index) => ({
      type: 'rootBlock',
      attrs: { id: rootId },
      content: [{
        type: 'baseBlock',
        attrs: { id: `block-${rootId.slice(5)}`, blockType: 'base' },
        content: [{ type: 'text', text: `段落 ${index + 1}` }],
      }],
    })),
  });
}

/** 指向已删除块的旧数据只能来自历史写入路径；现行 setPendingRevision 会拒绝不存在的目标块。 */
function insertOrphanPending(db: Database.Database, documentId: string, targetBlockId: string): void {
  db.prepare(`
    INSERT INTO markdown_block_pending_revisions (
      id, document_node_id, target_block_id, new_markdown, source, operation, meta_json, created_at
    ) VALUES (?, ?, ?, '旧提议', 'ai', 'update', NULL, 1)
  `).run(`pending-${targetBlockId}`, documentId, targetBlockId);
}

function insertBlockVersion(db: Database.Database, documentId: string, targetBlockId: string): void {
  db.prepare(`
    INSERT INTO markdown_block_versions (
      id, document_node_id, target_block_id, block_type, version_number, content_json, origin_type, created_at
    ) VALUES (?, ?, ?, 'baseBlock', 1, '{}', 'manual', 1)
  `).run(`version-${targetBlockId}`, documentId, targetBlockId);
}

describe('MarkdownOrphanBlockDataCleaner', () => {
  it('只列出挂有 pending 或块历史的文档，无卫星数据的文档不进入复查', () => {
    const { db, service, cleaner } = setup();
    createDocument(db, service, 'doc-pending', ['root-pending01']);
    createDocument(db, service, 'doc-history', ['root-history01']);
    createDocument(db, service, 'doc-both', ['root-both0001']);
    createDocument(db, service, 'doc-plain', ['root-plain001']);
    service.setPendingRevision('doc-pending', 'root-pending01', '新段落');
    insertBlockVersion(db, 'doc-history', 'root-history01');
    service.setPendingRevision('doc-both', 'root-both0001', '新段落');
    insertBlockVersion(db, 'doc-both', 'root-both0001');

    expect(cleaner.listDocumentsWithBlockSatelliteData().sort()).toEqual([
      'doc-both',
      'doc-history',
      'doc-pending',
    ]);
  });

  it('只删除指向已删除块的卫星数据，且不为每篇文档输出日志', () => {
    const { db, service, cleaner } = setup();
    createDocument(db, service, 'doc-mixed', ['root-live0001', 'root-live0002']);
    service.setPendingRevision('doc-mixed', 'root-live0001', '保留的提议');
    insertOrphanPending(db, 'doc-mixed', 'root-gone0001');
    insertBlockVersion(db, 'doc-mixed', 'root-live0002');
    insertBlockVersion(db, 'doc-mixed', 'root-gone0002');
    const log = vi.spyOn(console, 'log');

    const result = cleaner.cleanupDocumentOrphans('doc-mixed');

    expect(result).toEqual({ removedPending: 1, removedBlockVersions: 1 });
    expect(service.getPendingRevisions('doc-mixed').map(pending => pending.target_block_id)).toEqual(['root-live0001']);
    expect(
      db.prepare('SELECT target_block_id FROM markdown_block_versions WHERE document_node_id = ?').all('doc-mixed')
    ).toEqual([{ target_block_id: 'root-live0002' }]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
