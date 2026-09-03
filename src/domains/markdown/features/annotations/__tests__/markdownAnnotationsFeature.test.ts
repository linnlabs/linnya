import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateRefId } from '../../../../../shared/utils/refIdGenerator';
import { flattenMarkdownDocumentBlocks } from '../../../shared';
import { MARKDOWN_DOCUMENT_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/document.schema';
import {
  MarkdownAnnotationRepository,
  MarkdownAnnotationsService,
  resolveMarkdownAnnotationTarget,
  SqliteMarkdownAnnotationDocumentReader,
} from '..';

const DOCUMENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const BLOCK_ID = '550e8400-e29b-41d4-a716-446655440001';

describe('Markdown annotations feature', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY)');
    for (const schema of MARKDOWN_DOCUMENT_SCHEMAS) db.exec(schema);
    db.prepare('INSERT INTO workspace_nodes (id) VALUES (?)').run(DOCUMENT_ID);
    db.prepare(`
      INSERT INTO document_versions (
        id, node_id, version_number, content_json, char_count, created_at, author_id
      ) VALUES (?, ?, 1, ?, 4, 1, NULL)
    `).run(
      '550e8400-e29b-41d4-a716-446655440002',
      DOCUMENT_ID,
      JSON.stringify({
        type: 'doc',
        content: [{
          type: 'rootBlock',
          attrs: { id: BLOCK_ID },
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: '正文' }],
          }],
        }],
      }),
    );
  });

  afterEach(() => db.close());

  it('从正式版本解析 ref，并由批注服务再次校验目标块后写入', () => {
    const reader = new SqliteMarkdownAnnotationDocumentReader(db);
    const blocks = flattenMarkdownDocumentBlocks(reader.getDocument(DOCUMENT_ID));
    const resolved = resolveMarkdownAnnotationTarget({
      ref: generateRefId(BLOCK_ID),
      baseBlocks: blocks,
    });
    expect(resolved).toEqual({ status: 'ok', resolvedId: BLOCK_ID, from: 'ref' });
    if (resolved.status !== 'ok') throw new Error('测试前置 ref 解析失败');

    const service = new MarkdownAnnotationsService(
      new MarkdownAnnotationRepository(db),
      reader,
    );
    service.create({
      id: '550e8400-e29b-41d4-a716-446655440003',
      documentNodeId: DOCUMENT_ID,
      targetBlockId: resolved.resolvedId,
      contentJson: JSON.stringify({ content: '建议补充依据' }),
      createdAt: '2026-08-10T00:00:00.000Z',
    });

    expect(service.listForDocument(DOCUMENT_ID)).toHaveLength(1);
  });

  it('拒绝不属于当前正式版本的块，不靠 ref 或调用方声明兜底', () => {
    const reader = new SqliteMarkdownAnnotationDocumentReader(db);
    const service = new MarkdownAnnotationsService(
      new MarkdownAnnotationRepository(db),
      reader,
    );

    expect(() => service.create({
      id: '550e8400-e29b-41d4-a716-446655440004',
      documentNodeId: DOCUMENT_ID,
      targetBlockId: '550e8400-e29b-41d4-a716-446655440099',
      contentJson: JSON.stringify({ content: '错误目标' }),
      createdAt: '2026-08-10T00:00:00.000Z',
    })).toThrow('目标块不存在');
  });
});
