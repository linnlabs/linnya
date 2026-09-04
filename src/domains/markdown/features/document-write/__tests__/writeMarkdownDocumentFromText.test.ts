import { describe, expect, it } from 'vitest';
import {
  writeMarkdownDocumentFromText,
  type MarkdownDocumentWriteStore,
} from '../orchestration/writeMarkdownDocumentFromText';
import { planMarkdownBlocks } from '../../normalization';
import type { MarkdownDocJson } from '../../normalization/runtime';
import type { DocumentVersion } from '../../document-storage';

interface PendingRow {
  readonly target_block_id: string;
  readonly new_markdown: string | null;
  readonly operation?: 'insert' | 'update' | 'delete' | null;
  readonly meta_json: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNodeId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.attrs)) return null;
  return typeof value.attrs.id === 'string' ? value.attrs.id : null;
}

function createTouchRecorder() {
  const calls: Array<readonly [string, number]> = [];
  return {
    calls,
    touchDocumentUpdatedAt(documentId: string, updatedAt: number) {
      calls.push([documentId, updatedAt]);
    },
  };
}

class FakeMarkdownService implements MarkdownDocumentWriteStore {
  readonly pending = new Map<string, PendingRow>();

  private versionNumber = 1;

  constructor(private doc: MarkdownDocJson) {}

  getDocument(): MarkdownDocJson {
    return this.doc;
  }

  getLatestVersion(): DocumentVersion {
    return {
      id: `version-${this.versionNumber}`,
      node_id: 'doc-1',
      version_number: this.versionNumber,
      content_json: JSON.stringify(this.doc),
      char_count: 0,
      created_at: 0,
      author_id: null,
    };
  }

  updateDocument(_documentId: string, content: MarkdownDocJson): DocumentVersion {
    this.doc = content;
    this.versionNumber += 1;
    return this.getLatestVersion();
  }

  getPendingRevisions(): PendingRow[] {
    return Array.from(this.pending.values());
  }

  runInTransaction<T>(fn: () => T): T {
    return fn();
  }

  insertEmptyBlockAfter(_documentId: string, anchorBlockId: string, newBlockId: string): void {
    const content = this.doc.content;
    const anchorIndex = content.findIndex(node => readNodeId(node) === anchorBlockId);
    if (anchorIndex === -1) {
      throw new Error('fake anchor missing');
    }
    const nextContent = [...content];
    nextContent.splice(anchorIndex + 1, 0, {
      type: 'rootBlock',
      attrs: { id: newBlockId },
      content: [{ type: 'baseBlock', attrs: { id: `${newBlockId}-inner` }, content: [] }],
    });
    this.doc = { type: 'doc', content: nextContent };
  }

  setPendingRevisionForToolIntent(params: {
    readonly documentId: string;
    readonly blockId: string;
    readonly newMarkdown: string;
    readonly source?: 'ai' | 'user' | 'tool';
    readonly meta?: { readonly operation?: unknown };
  }): unknown {
    const operation = params.meta?.operation;
    this.pending.set(params.blockId, {
      target_block_id: params.blockId,
      new_markdown: params.newMarkdown,
      operation:
        operation === 'insert' || operation === 'update' || operation === 'delete'
          ? operation
          : null,
      meta_json: params.meta ? JSON.stringify(params.meta) : null,
    });
    return { cancelled: false };
  }
}

function markdownDoc(blocks: readonly { readonly id: string; readonly text: string }[]): MarkdownDocJson {
  return {
    type: 'doc',
    content: blocks.map(block => ({
      type: 'rootBlock',
      attrs: { id: block.id },
      content: [
        {
          type: 'paragraphBlock',
          content: block.text.length > 0 ? [{ type: 'text', text: block.text }] : [],
        },
      ],
    })),
  };
}

function markdownDocWithWebCitation(): MarkdownDocJson {
  const url = 'https://example.com/source';
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: 'b1' },
        content: [
          {
            type: 'paragraphBlock',
            content: [
              { type: 'text', text: 'Alpha ' },
              {
                type: 'citationNode',
                attrs: {
                  citationId: 'citation-1',
                  sourceType: 'web',
                  sourceId: url,
                  url,
                  title: 'Example source',
                  snippet: 'Quoted source text',
                  ref: 'ABC234',
                },
              },
            ],
          },
        ],
      },
      {
        type: 'rootBlock',
        attrs: { id: 'b2' },
        content: [
          {
            type: 'paragraphBlock',
            content: [{ type: 'text', text: 'Beta' }],
          },
        ],
      },
    ],
  };
}

describe('writeMarkdownDocumentFromText', () => {
  const annotationAdmission = {
    author: 'AI',
    meta: { source: 'agent' as const, runId: 'run-1' },
  };

  it('将全文目标转换为 update/delete pending，并 touch workspace node', async () => {
    const touch = createTouchRecorder();
    const service = new FakeMarkdownService(
      markdownDoc([
        { id: 'b1', text: 'Alpha' },
        { id: 'b2', text: 'Beta' },
        { id: 'b3', text: 'Gamma' },
      ])
    );

    const result = await writeMarkdownDocumentFromText({
      documentStore: service,
      documentId: 'doc-1',
      targetText: 'Alpha\n\nBeta edited',
      toolName: 'edit_file',
      annotationAdmission,
      touchDocumentUpdatedAt: touch.touchDocumentUpdatedAt,
    });

    expect(result.edits.map(edit => edit.operation)).toEqual(['update', 'delete']);
    expect(service.pending.get('b2')).toMatchObject({
      new_markdown: 'Beta edited',
      operation: 'update',
    });
    expect(service.pending.get('b3')).toMatchObject({ new_markdown: '', operation: 'delete' });
    expect(touch.calls[0]?.[0]).toBe('doc-1');
  });

  it('目标块更多时创建 insert pending', async () => {
    const touch = createTouchRecorder();
    const service = new FakeMarkdownService(markdownDoc([{ id: 'b1', text: 'Alpha' }]));

    const result = await writeMarkdownDocumentFromText({
      documentStore: service,
      documentId: 'doc-1',
      targetText: 'Alpha\n\nBeta',
      toolName: 'write_file',
      annotationAdmission,
      touchDocumentUpdatedAt: touch.touchDocumentUpdatedAt,
    });

    expect(result.edits.map(edit => edit.operation)).toEqual(['insert']);
    const inserted = result.edits[0];
    expect(inserted?.blockId).toBeTruthy();
    expect(service.pending.get(inserted?.blockId ?? '')).toMatchObject({
      new_markdown: 'Beta',
      operation: 'insert',
    });
  });

  it('普通 HTML comment 直接创建 confirmed 批注，不生成 Revision pending', async () => {
    const touch = createTouchRecorder();
    const service = new FakeMarkdownService(markdownDoc([{ id: 'b1', text: 'Alpha' }]));

    const result = await writeMarkdownDocumentFromText({
      documentStore: service,
      documentId: 'doc-1',
      targetText: 'Alpha\n\n<!-- 建议补充依据 -->',
      toolName: 'edit_file',
      annotationAdmission,
      touchDocumentUpdatedAt: touch.touchDocumentUpdatedAt,
    });

    expect(result.edits).toEqual([]);
    expect(result.createdAnnotationIds).toHaveLength(1);
    expect(service.pending.size).toBe(0);
    expect(service.getDocument().content[0]?.attrs?.annotations).toEqual([
      expect.objectContaining({
        content: '建议补充依据',
        state: 'confirmed',
        author: 'AI',
        meta: { source: 'agent', runId: 'run-1' },
      }),
    ]);
  });

  it('写 pending 时合并按 Markdown 块传入的 citation hydration 元数据', async () => {
    const touch = createTouchRecorder();
    const service = new FakeMarkdownService(markdownDoc([{ id: 'b1', text: 'Alpha' }]));

    const planned = await planMarkdownBlocks('Alpha with [@ABC123]');
    const blockMarkdown = planned.blocks[0] ?? 'Alpha with [@ABC123]';

    await writeMarkdownDocumentFromText({
      documentStore: service,
      documentId: 'doc-1',
      targetText: 'Alpha with [@ABC123]',
      toolName: 'edit_file',
      pendingMetaByMarkdown: new Map([
        [blockMarkdown, { citation_hydration: { ABC123: { sourceId: 's1' } } }],
      ]),
      annotationAdmission,
      touchDocumentUpdatedAt: touch.touchDocumentUpdatedAt,
    });

    const meta = service.pending.get('b1')?.meta_json;
    expect(meta).toContain('citation_hydration');
    expect(meta).toContain('ABC123');
    expect(meta).toContain('operation');
  });

  it('写入规划复用 citation-aware 当前视图，不把未修改的引用块误判为变化', async () => {
    const touch = createTouchRecorder();
    const service = new FakeMarkdownService(markdownDocWithWebCitation());

    const result = await writeMarkdownDocumentFromText({
      documentStore: service,
      documentId: 'doc-citation',
      targetText: 'Alpha [@ABC234]\n\nBeta edited',
      toolName: 'edit_file',
      annotationAdmission,
      touchDocumentUpdatedAt: touch.touchDocumentUpdatedAt,
    });

    expect(result.currentText).toBe('Alpha [@ABC234]\n\nBeta');
    expect(result.edits).toEqual([
      expect.objectContaining({
        operation: 'update',
        blockId: 'b2',
      }),
    ]);
    expect(service.pending.has('b1')).toBe(false);
    expect(service.pending.get('b2')).toMatchObject({
      new_markdown: 'Beta edited',
      operation: 'update',
    });
  });

  it('拒绝用块序号补造缺失的 root block identity', async () => {
    const touch = createTouchRecorder();
    const service = new FakeMarkdownService({
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: {},
          content: [{ type: 'paragraphBlock', content: [{ type: 'text', text: 'Alpha' }] }],
        },
      ],
    });

    await expect(
      writeMarkdownDocumentFromText({
        documentStore: service,
        documentId: 'doc-missing-block-id',
        targetText: 'Alpha edited',
        toolName: 'edit_file',
        annotationAdmission,
        touchDocumentUpdatedAt: touch.touchDocumentUpdatedAt,
      })
    ).rejects.toThrow('missing its admitted block identity');
    expect(service.pending.size).toBe(0);
    expect(touch.calls).toEqual([]);
  });
});
