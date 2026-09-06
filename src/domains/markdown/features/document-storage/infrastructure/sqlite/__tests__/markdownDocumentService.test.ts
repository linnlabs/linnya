import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { AUDIO_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/audio.schema';
import { BLOCK_HISTORY_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { PENDING_REVISION_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { MarkdownDocumentService } from 'src/domains/markdown';

function setup(): {
  readonly db: Database.Database;
  readonly service: MarkdownDocumentService;
  readonly documentId: string;
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

  const documentId = 'doc-touch-updated-at';
  db.prepare(`
    INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, icon, created_at, updated_at)
    VALUES (?, NULL, NULL, 'document', 'doc', NULL, ?, ?)
  `).run(documentId, 1, 1);

  return {
    db,
    service: new MarkdownDocumentService(db),
    documentId,
  };
}

function createDocWithImage(imageId: string, src: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: 'root-1' },
        content: [
          {
            type: 'imageBlock',
            attrs: {
              id: imageId,
              src,
              alt: '示例图',
              title: '标题',
              width: 320,
              height: 240,
              alignment: 'center',
              uploadedAt: 1234,
            },
          },
        ],
      },
    ],
  };
}

function createValidDocument(): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{
      type: 'rootBlock',
      attrs: { id: 'root-valid' },
      content: [{
        type: 'baseBlock',
        attrs: { id: 'block-valid' },
        content: [],
      }],
    }],
  };
}

function readWorkspaceNodeUpdatedAt(db: Database.Database, id: string): number {
  const row = db.prepare('SELECT updated_at FROM workspace_nodes WHERE id = ?').get(id) as { updated_at: number } | undefined;
  if (!row) {
    throw new Error(`workspace node not found in test: ${id}`);
  }
  return row.updated_at;
}

describe('MarkdownDocumentService', () => {
  it('持久化边界拒绝缺失或重复的 root block identity', () => {
    const { service, documentId } = setup();

    expect(() => service.createDocument(documentId, {
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: {},
        content: [{ type: 'baseBlock', attrs: { id: 'block-missing-root-id' }, content: [] }],
      }],
    })).toThrow('missing its admitted block identity');
    expect(service.getLatestVersion(documentId)).toBeNull();

    expect(() => service.createDocument(documentId, {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-duplicate' },
          content: [{ type: 'baseBlock', attrs: { id: 'block-duplicate-a' }, content: [] }],
        },
        {
          type: 'rootBlock',
          attrs: { id: 'root-duplicate' },
          content: [{ type: 'baseBlock', attrs: { id: 'block-duplicate-b' }, content: [] }],
        },
      ],
    })).toThrow('repeats block identity root-duplicate');
    expect(service.getLatestVersion(documentId)).toBeNull();
  });

  it('保存正文新版本时同步刷新 workspace node 修改时间', () => {
    const { db, service, documentId } = setup();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1000));
      service.saveNewVersion(documentId, JSON.stringify(createValidDocument()));

      expect(readWorkspaceNodeUpdatedAt(db, documentId)).toBe(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('持久化边界拒绝不属于 Markdown schema 的节点和属性', () => {
    const { service, documentId } = setup();

    expect(() => service.createDocument(documentId, JSON.stringify({
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: { id: 'root-invalid', unknown: true },
        content: [{ type: 'baseBlock', attrs: { id: 'block-invalid' }, content: [] }],
      }],
    }))).toThrow('未知属性 "unknown"');

    expect(() => service.createDocument(documentId, JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    }))).toThrow('未知 node "paragraph"');
    expect(service.getLatestVersion(documentId)).toBeNull();
  });

  it('保存版本时写入 schema 规范化后的 JSON', () => {
    const { service, documentId } = setup();

    const version = service.saveNewVersion(documentId, JSON.stringify(createValidDocument()));

    expect(JSON.parse(version.content_json)).toMatchObject({
      content: [{
        attrs: {
          id: 'root-valid',
          annotations: [],
          isDragging: false,
        },
        content: [{
          attrs: {
            id: 'block-valid',
            blockType: 'base',
            textAlign: 'left',
          },
        }],
      }],
    });
  });

  it('保存版本时按中文汉字和英文单词计算内容统计单位', () => {
    const { service, documentId } = setup();

    const version = service.saveNewVersion(documentId, JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-count' },
          content: [{ type: 'baseBlock', content: [{ type: 'text', text: "你好 hello don't 123" }] }],
        },
      ],
    }));

    expect(version.char_count).toBe(4);
  });

  it('保存文档时把 imageBlock 投影到 image_blocks，并在删除图片后清理孤儿', () => {
    const { db, service, documentId } = setup();

    service.updateDocument(documentId, createDocWithImage('image-1', 'media://load/doc-image/aW1hZ2UtMS5wbmc'));

    const imageRow = db.prepare('SELECT * FROM image_blocks WHERE id = ?').get('image-1') as {
      document_node_id: string;
      src: string;
      asset_id: string | null;
      alt: string | null;
      width: number | null;
      height: number | null;
    } | undefined;

    expect(imageRow).toMatchObject({
      document_node_id: documentId,
      src: 'media://load/doc-image/aW1hZ2UtMS5wbmc',
      asset_id: null,
      alt: '示例图',
      width: 320,
      height: 240,
    });

    service.updateDocument(documentId, {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-1' },
          content: [{ type: 'baseBlock', content: [] }],
        },
      ],
    });

    const remaining = db.prepare('SELECT COUNT(*) as count FROM image_blocks WHERE document_node_id = ?')
      .get(documentId) as { count: number };
    expect(remaining.count).toBe(0);
  });

  it('updateDocument 参与外层事务，后续写操作失败时会回滚正文版本', () => {
    const { db, service, documentId } = setup();

    service.updateDocument(documentId, {
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: { id: 'root-1' },
        content: [{ type: 'baseBlock', attrs: { id: 'block-rollback' }, content: [] }],
      }],
    });
    const before = service.getLatestVersion(documentId);

    expect(() => {
      service.runInTransaction(() => {
        service.updateDocument(documentId, createDocWithImage('image-rollback', 'media://load/doc-image/cm9sbGJhY2sucG5n'));
        throw new Error('force rollback');
      });
    }).toThrow();

    const after = service.getLatestVersion(documentId);
    expect(after?.id).toBe(before?.id);
    const imageRows = db.prepare('SELECT COUNT(*) as count FROM image_blocks WHERE id = ?')
      .get('image-rollback') as { count: number };
    expect(imageRows.count).toBe(0);
  });
});
