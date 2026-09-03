import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import {
  MarkdownDocumentService,
  PendingRevisionApplyService,
  type MarkdownImporter,
} from 'src/domains/markdown';
import type { MarkdownDocJson, ProseMirrorJsonNode } from 'src/domains/markdown';

function rootBlock(
  id: string,
  text: string,
  attrs: Record<string, unknown> = {}
): ProseMirrorJsonNode {
  return {
    type: 'rootBlock',
    attrs: { ...attrs, id },
    content: [
      {
        type: 'baseBlock',
        attrs: { id: `${id}-inner` },
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  };
}

function doc(blocks: ProseMirrorJsonNode[]): MarkdownDocJson {
  return {
    type: 'doc',
    content: blocks,
  };
}

function firstText(block: ProseMirrorJsonNode | undefined): string {
  const inner = block?.content?.[0];
  const textNode = inner?.content?.[0];
  return typeof textNode?.text === 'string' ? textNode.text : '';
}

function setup(initialDoc: MarkdownDocJson): {
  db: Database.Database;
  markdownService: MarkdownDocumentService;
  applyService: PendingRevisionApplyService;
  documentId: string;
} {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const statement of [
    ...CORE_SCHEMAS,
    ...ASSET_LEDGER_SCHEMAS,
    ...MARKDOWN_DOCUMENT_SCHEMAS,
    ...IMAGE_BLOCK_SCHEMAS,
    ...PENDING_REVISION_SCHEMAS,
    ...BLOCK_HISTORY_SCHEMAS,
  ]) {
    db.exec(statement);
  }

  const now = Date.now();
  db.prepare(
    `
    INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, icon, created_at, updated_at)
    VALUES (?, NULL, NULL, 'document', 'doc', NULL, ?, ?)
  `
  ).run('doc-1', now, now);

  const markdownService = new MarkdownDocumentService(db);
  markdownService.createDocument('doc-1', initialDoc);

  const importer: MarkdownImporter = async markdown => ({
    docJson: doc([rootBlock(`imported-${markdown}`, markdown)]),
    blockEvents: [],
  });

  return {
    db,
    markdownService,
    applyService: new PendingRevisionApplyService(markdownService, importer),
    documentId: 'doc-1',
  };
}

function pending(
  service: MarkdownDocumentService,
  documentId: string,
  blockId: string,
  newMarkdown: string,
  operation: 'insert' | 'update' | 'delete',
  meta: Record<string, unknown> = {}
): void {
  service.setPendingRevision(documentId, blockId, newMarkdown, 'tool', {
    ...meta,
    operation,
  });
}

function readDoc(service: MarkdownDocumentService, documentId: string): MarkdownDocJson {
  return service.getDocument(documentId);
}

describe('PendingRevisionApplyService', () => {
  it('accept update 会替换内容并保留 rootBlock id 与既有 attrs', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('b1', 'old', { backgroundColor: 'blue_bg' })])
    );
    pending(markdownService, documentId, 'b1', 'new', 'update');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('ok');
    expect(result.appliedCount).toBe(1);
    expect(result.docJson.content).toHaveLength(1);
    expect(result.docJson.content[0]?.attrs?.id).toBe('b1');
    expect(result.docJson.content[0]?.attrs?.backgroundColor).toBe('blue_bg');
    expect(firstText(result.docJson.content[0])).toBe('new');
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('accept insert 会填充占位块并保留占位块 id', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('anchor', 'anchor'), rootBlock('inserted-block', '')])
    );
    pending(markdownService, documentId, 'inserted-block', 'inserted text', 'insert');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('ok');
    expect(result.docJson.content.map(block => block.attrs?.id)).toEqual([
      'anchor',
      'inserted-block',
    ]);
    expect(firstText(result.docJson.content[1])).toBe('inserted text');
  });

  it('accept delete 会删除目标 rootBlock', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('keep', 'keep'), rootBlock('remove', 'remove')])
    );
    pending(markdownService, documentId, 'remove', '', 'delete');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('ok');
    expect(result.docJson.content.map(block => block.attrs?.id)).toEqual(['keep']);
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('accept 混合 update/insert/delete 时保持文档顺序', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([
        rootBlock('b0', 'b0'),
        rootBlock('u1', 'old u1'),
        rootBlock('i1', ''),
        rootBlock('d1', 'delete me'),
        rootBlock('u2', 'old u2'),
      ])
    );
    pending(markdownService, documentId, 'u1', 'new u1', 'update');
    pending(markdownService, documentId, 'i1', 'new insert', 'insert');
    pending(markdownService, documentId, 'd1', '', 'delete');
    pending(markdownService, documentId, 'u2', 'new u2', 'update');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('ok');
    expect(result.docJson.content.map(block => block.attrs?.id)).toEqual(['b0', 'u1', 'i1', 'u2']);
    expect(result.docJson.content.map(block => firstText(block))).toEqual([
      'b0',
      'new u1',
      'new insert',
      'new u2',
    ]);
  });

  it('accept 同锚点连续 insert 时尊重占位块既有顺序', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([
        rootBlock('anchor', 'anchor'),
        rootBlock('i1', ''),
        rootBlock('i2', ''),
        rootBlock('i3', ''),
      ])
    );
    pending(markdownService, documentId, 'i1', 'first', 'insert', { anchorBlockId: 'anchor' });
    pending(markdownService, documentId, 'i2', 'second', 'insert', { anchorBlockId: 'anchor' });
    pending(markdownService, documentId, 'i3', 'third', 'insert', { anchorBlockId: 'anchor' });

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('ok');
    expect(result.docJson.content.map(block => firstText(block))).toEqual([
      'anchor',
      'first',
      'second',
      'third',
    ]);
  });

  it('accept citation pending 时会把 hydration 注入 CitationNode', async () => {
    const { markdownService, documentId, db } = setup(doc([rootBlock('b1', 'old')]));
    const importer: MarkdownImporter = async () => ({
      docJson: doc([rootBlock('imported', '引用 [@Abc234]')]),
      blockEvents: [],
    });
    const applyService = new PendingRevisionApplyService(markdownService, importer);

    pending(markdownService, documentId, 'b1', '引用 [@Abc234]', 'update', {
      citation_hydration: {
        Abc234: {
          docId: 'kb-doc',
          blockId: 'kb-block',
          title: '引用标题',
          snippet: '引用片段',
          kbId: 'kb-1',
        },
      },
    });

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });
    db.close();

    const inlineNodes = result.docJson.content[0]?.content?.[0]?.content ?? [];
    const citationNode = inlineNodes.find(node => node.type === 'citationNode');
    expect(result.status).toBe('ok');
    expect(citationNode?.attrs).toMatchObject({
      ref: 'Abc234',
      sourceId: 'kb-doc',
      blockId: 'kb-block',
      title: '引用标题',
      snippet: '引用片段',
    });
  });

  it('accept Link pending 后持久化 href/title，重新读取仍可通过正式 schema', async () => {
    const { markdownService, documentId } = setup(doc([rootBlock('b1', 'old')]));
    const importer: MarkdownImporter = async () => ({
      docJson: {
        type: 'doc',
        content: [
          {
            type: 'rootBlock',
            attrs: { id: 'imported' },
            content: [
              {
                type: 'baseBlock',
                attrs: { id: 'imported-inner' },
                content: [
                  {
                    type: 'text',
                    text: '链接',
                    marks: [
                      {
                        type: 'link',
                        attrs: { href: 'https://example.com', title: '示例' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      blockEvents: [],
    });
    const applyService = new PendingRevisionApplyService(markdownService, importer);
    pending(markdownService, documentId, 'b1', '[链接](https://example.com)', 'update');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });
    const persistedMarks = readDoc(markdownService, documentId).content[0]?.content?.[0]
      ?.content?.[0]?.marks;

    expect(result.status).toBe('ok');
    expect(persistedMarks).toEqual([
      {
        type: 'link',
        attrs: { href: 'https://example.com', title: '示例' },
      },
    ]);
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('accept 1000 块时一次性合并并清空 pending', async () => {
    const blocks = Array.from({ length: 1000 }, (_, index) =>
      rootBlock(`b${index}`, `old ${index}`)
    );
    const { markdownService, applyService, documentId } = setup(doc(blocks));
    for (let index = 0; index < 1000; index += 1) {
      pending(markdownService, documentId, `b${index}`, `new ${index}`, 'update');
    }

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('ok');
    expect(result.appliedCount).toBe(1000);
    expect(firstText(result.docJson.content[999])).toBe('new 999');
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('reject insert 会删除占位块', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('anchor', 'anchor'), rootBlock('inserted-block', '')])
    );
    pending(markdownService, documentId, 'inserted-block', 'inserted text', 'insert');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'reject' });

    expect(result.status).toBe('ok');
    expect(result.docJson.content.map(block => block.attrs?.id)).toEqual(['anchor']);
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('reject update/delete 不改正文，只清空 pending', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('u1', 'old update'), rootBlock('d1', 'old delete')])
    );
    pending(markdownService, documentId, 'u1', 'new update', 'update');
    pending(markdownService, documentId, 'd1', '', 'delete');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'reject' });

    expect(result.status).toBe('ok');
    expect(result.docJson.content.map(block => firstText(block))).toEqual([
      'old update',
      'old delete',
    ]);
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('blockId 不存在时标记 skipped，其他 pending 继续应用', async () => {
    const { markdownService, applyService, documentId, db } = setup(doc([rootBlock('b1', 'old')]));
    pending(markdownService, documentId, 'b1', 'new', 'update');
    db.prepare(
      `
      INSERT INTO markdown_block_pending_revisions (
        id, document_node_id, target_block_id, new_markdown, source, operation, meta_json, created_at
      ) VALUES (?, ?, ?, ?, 'tool', 'update', ?, ?)
    `
    ).run(
      'ghost-pending',
      documentId,
      'ghost',
      'ghost text',
      JSON.stringify({ operation: 'update' }),
      Date.now()
    );

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('ok');
    expect(result.appliedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(firstText(result.docJson.content[0])).toBe('new');
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('预解析失败时不更新正文也不清 pending', async () => {
    const { markdownService, documentId } = setup(doc([rootBlock('b1', 'old')]));
    const failingImporter: MarkdownImporter = async () => {
      throw new Error('parser failed');
    };
    const applyService = new PendingRevisionApplyService(markdownService, failingImporter);
    pending(markdownService, documentId, 'b1', 'new', 'update');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });
    const afterDoc = readDoc(markdownService, documentId);

    expect(result.status).toBe('failed');
    expect(firstText(afterDoc.content[0])).toBe('old');
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(1);
  });

  it('最终合并文档含未知 mark 时在事务提交前失败，并保留正文与 pending', async () => {
    const { markdownService, documentId } = setup(doc([rootBlock('b1', 'old')]));
    const invalidImporter: MarkdownImporter = async () => ({
      docJson: {
        type: 'doc',
        content: [
          {
            type: 'rootBlock',
            attrs: { id: 'imported' },
            content: [
              {
                type: 'baseBlock',
                attrs: { id: 'imported-inner' },
                content: [
                  {
                    type: 'text',
                    text: 'invalid',
                    marks: [{ type: 'unknownMark' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      blockEvents: [],
    });
    const applyService = new PendingRevisionApplyService(markdownService, invalidImporter);
    pending(markdownService, documentId, 'b1', 'new', 'update');

    const result = await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });

    expect(result.status).toBe('failed');
    expect(result.errors?.[0]?.reason).toContain('unknownMark');
    expect(firstText(readDoc(markdownService, documentId).content[0])).toBe('old');
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(1);
  });

  it('accept 后重新读取文档能拿到合并后的内容', async () => {
    const { markdownService, applyService, documentId } = setup(doc([rootBlock('b1', 'old')]));
    pending(markdownService, documentId, 'b1', 'new', 'update');

    await applyService.applyAllPendingForDocument({ documentId, mode: 'accept' });
    const persistedDoc = readDoc(markdownService, documentId);

    expect(firstText(persistedDoc.content[0])).toBe('new');
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('single accept update 只合并目标块并清理对应 pending', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('b1', 'old 1', { backgroundColor: 'blue_bg' }), rootBlock('b2', 'old 2')])
    );
    pending(markdownService, documentId, 'b1', 'new 1', 'update');
    pending(markdownService, documentId, 'b2', 'new 2', 'update');

    const result = await applyService.applyPendingForBlock({
      documentId,
      blockId: 'b1',
      mode: 'accept',
    });
    const persistedDoc = readDoc(markdownService, documentId);

    expect(result.status).toBe('ok');
    expect(result.appliedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(firstText(persistedDoc.content[0])).toBe('new 1');
    expect(persistedDoc.content[0]?.attrs?.id).toBe('b1');
    expect(persistedDoc.content[0]?.attrs?.backgroundColor).toBe('blue_bg');
    expect(firstText(persistedDoc.content[1])).toBe('old 2');
    expect(
      markdownService.getPendingRevisions(documentId).map(item => item.target_block_id)
    ).toEqual(['b2']);
  });

  it('single reject update 不改正文，只清理目标 pending', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('b1', 'old 1'), rootBlock('b2', 'old 2')])
    );
    pending(markdownService, documentId, 'b1', 'new 1', 'update');
    pending(markdownService, documentId, 'b2', 'new 2', 'update');

    const result = await applyService.applyPendingForBlock({
      documentId,
      blockId: 'b1',
      mode: 'reject',
    });
    const persistedDoc = readDoc(markdownService, documentId);

    expect(result.status).toBe('ok');
    expect(result.appliedCount).toBe(1);
    expect(firstText(persistedDoc.content[0])).toBe('old 1');
    expect(firstText(persistedDoc.content[1])).toBe('old 2');
    expect(
      markdownService.getPendingRevisions(documentId).map(item => item.target_block_id)
    ).toEqual(['b2']);
  });

  it('single reject insert 会删除插入占位块但保留其他 pending', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('anchor', 'anchor'), rootBlock('i1', ''), rootBlock('b2', 'old 2')])
    );
    pending(markdownService, documentId, 'i1', 'inserted', 'insert');
    pending(markdownService, documentId, 'b2', 'new 2', 'update');

    const result = await applyService.applyPendingForBlock({
      documentId,
      blockId: 'i1',
      mode: 'reject',
    });
    const persistedDoc = readDoc(markdownService, documentId);

    expect(result.status).toBe('ok');
    expect(result.appliedCount).toBe(1);
    expect(persistedDoc.content.map(block => block.attrs?.id)).toEqual(['anchor', 'b2']);
    expect(
      markdownService.getPendingRevisions(documentId).map(item => item.target_block_id)
    ).toEqual(['b2']);
  });

  it('single accept delete 会删除目标块但保留其他 pending', async () => {
    const { markdownService, applyService, documentId } = setup(
      doc([rootBlock('keep', 'keep'), rootBlock('remove', 'remove'), rootBlock('b2', 'old 2')])
    );
    pending(markdownService, documentId, 'remove', '', 'delete');
    pending(markdownService, documentId, 'b2', 'new 2', 'update');

    const result = await applyService.applyPendingForBlock({
      documentId,
      blockId: 'remove',
      mode: 'accept',
    });
    const persistedDoc = readDoc(markdownService, documentId);

    expect(result.status).toBe('ok');
    expect(result.appliedCount).toBe(1);
    expect(persistedDoc.content.map(block => block.attrs?.id)).toEqual(['keep', 'b2']);
    expect(
      markdownService.getPendingRevisions(documentId).map(item => item.target_block_id)
    ).toEqual(['b2']);
  });
});
