import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { extractRawMarkdownSource, type MarkdownDocJson, type MarkdownImportResult } from 'src/domains/markdown';
import { buildRawMarkdownPlaceholder } from 'src/domains/markdown';
import { MarkdownDocumentService, MarkdownNormalizationService } from 'src/domains/markdown';

function buildNormalizedDoc(text: string): MarkdownDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: 'root-fixed01' },
        content: [
          {
            type: 'baseBlock',
            attrs: { id: 'block-fixed01', blockType: 'base' },
            content: [{ type: 'text', text }]
          }
        ]
      }
    ]
  };
}

describe('MarkdownNormalizationService', () => {
  class FakeMarkdownDocumentService {
    private readonly documentStore = new Map<string, unknown>();
    private readonly pendingStore = new Map<string, Array<{ target_block_id: string }>>();

    createDocument(documentId: string, content: unknown): void {
      this.documentStore.set(documentId, content);
    }

    getDocument(documentId: string): unknown {
      const content = this.documentStore.get(documentId);
      if (content === undefined) {
        throw new Error(`Document not found: ${documentId}`);
      }
      return content;
    }

    updateDocument(documentId: string, content: unknown): void {
      this.documentStore.set(documentId, content);
      // 中文说明：真实实现会在 updateDocument 后触发 orphan cleaner；
      // 这里用最小 fake 模拟“旧占位块 pending 被清掉”的结果。
      this.pendingStore.set(documentId, []);
    }

    setPendingRevision(documentId: string, blockId: string): void {
      const current = this.pendingStore.get(documentId) ?? [];
      current.push({ target_block_id: blockId });
      this.pendingStore.set(documentId, current);
    }

    getPendingRevisions(documentId: string): Array<{ target_block_id: string }> {
      return this.pendingStore.get(documentId) ?? [];
    }
  }

  it('normalizes placeholder document and clears orphan pending revisions', async () => {
    const fakeDb = {
      prepare: () => ({
        all: () => [{ id: 'doc-1' }]
      })
    };
    const markdownService = new FakeMarkdownDocumentService();
    const documentId = 'doc-1';
    const placeholder = buildRawMarkdownPlaceholder('# 标题\n\n原始段落');
    markdownService.createDocument(documentId, placeholder);

    const rootBlocks = Array.isArray(placeholder.content) ? placeholder.content : [];
    const firstRootBlock = rootBlocks[0];
    const placeholderRootId =
      firstRootBlock &&
      typeof firstRootBlock === 'object' &&
      !Array.isArray(firstRootBlock) &&
      firstRootBlock.attrs &&
      typeof firstRootBlock.attrs === 'object' &&
      !Array.isArray(firstRootBlock.attrs) &&
      typeof firstRootBlock.attrs.id === 'string'
        ? firstRootBlock.attrs.id
        : null;
    expect(typeof placeholderRootId).toBe('string');
    markdownService.setPendingRevision(documentId, String(placeholderRootId));
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(1);

    const importer = async (): Promise<MarkdownImportResult> => ({
      docJson: buildNormalizedDoc('规范化后的正文'),
      blockEvents: []
    });
    const service = new MarkdownNormalizationService(
      fakeDb as unknown as Database.Database,
      markdownService as unknown as MarkdownDocumentService,
      importer
    );

    const result = await service.normalizeDocumentIfNeeded(documentId);

    expect(result.status).toBe('normalized');
    expect(result.changed).toBe(true);
    const latestDoc = markdownService.getDocument(documentId);
    expect(extractRawMarkdownSource(latestDoc)).toBeNull();
    expect(markdownService.getPendingRevisions(documentId)).toHaveLength(0);
  });

  it('batch normalization only counts placeholder documents as normalized', async () => {
    const fakeDb = {
      prepare: () => ({
        all: () => [{ id: 'doc-placeholder' }, { id: 'doc-normalized' }]
      })
    };
    const markdownService = new FakeMarkdownDocumentService();

    const placeholderDocumentId = 'doc-placeholder';
    markdownService.createDocument(
      placeholderDocumentId,
      buildRawMarkdownPlaceholder('批量规范化')
    );

    const normalizedDocumentId = 'doc-normalized';
    markdownService.createDocument(
      normalizedDocumentId,
      buildNormalizedDoc('已是结构化文档')
    );

    const importer = async (): Promise<MarkdownImportResult> => ({
      docJson: buildNormalizedDoc('批量规范化后的正文'),
      blockEvents: []
    });
    const service = new MarkdownNormalizationService(
      fakeDb as unknown as Database.Database,
      markdownService as unknown as MarkdownDocumentService,
      importer
    );

    const stats = await service.normalizeAllPendingPlaceholders();

    expect(stats.scanned).toBe(2);
    expect(stats.normalized).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.failed).toBe(0);
  });
});
