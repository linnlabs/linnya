import { describe, expect, it } from 'vitest';
import type { DocumentVersion } from '../../document-storage';
import type { MarkdownDocJson } from '../../normalization/runtime';
import {
  createMarkdownAnnotations,
  type MarkdownAnnotationCreationStore,
} from './createMarkdownAnnotations';

const baseDocument: MarkdownDocJson = {
  type: 'doc',
  content: [{
    type: 'rootBlock',
    attrs: { id: 'root-1', annotations: [] },
    content: [{
      type: 'paragraphBlock',
      content: [{ type: 'text', text: '正文' }],
    }],
  }],
};

class FakeAnnotationStore implements MarkdownAnnotationCreationStore {
  document = baseDocument;
  versionNumber = 3;

  runInTransaction<T>(fn: () => T): T {
    return fn();
  }

  getDocument(): MarkdownDocJson {
    return this.document;
  }

  getLatestVersion(): DocumentVersion {
    return {
      id: `version-${this.versionNumber}`,
      node_id: 'doc-1',
      version_number: this.versionNumber,
      content_json: JSON.stringify(this.document),
      char_count: 2,
      created_at: 0,
      author_id: null,
    };
  }

  updateDocument(_documentId: string, content: MarkdownDocJson): DocumentVersion {
    this.document = content;
    this.versionNumber += 1;
    return this.getLatestVersion();
  }
}

describe('createMarkdownAnnotations', () => {
  it('通过统一创建合同把一批批注写入一个新文档版本', () => {
    const store = new FakeAnnotationStore();
    const result = createMarkdownAnnotations({
      store,
      documentId: 'doc-1',
      expectedDocumentVersion: 3,
      drafts: [{ blockId: 'root-1', content: '建议补充依据' }],
      author: 'Reviewer',
      meta: { source: 'review', reviewRunId: 'review-1' },
      createId: () => 'annotation-1',
      now: () => '2026-09-04T00:00:00.000Z',
    });

    expect(result.version?.version_number).toBe(4);
    expect(result.created[0]?.annotation).toMatchObject({
      id: 'annotation-1',
      state: 'confirmed',
      meta: { source: 'review', reviewRunId: 'review-1' },
    });
    expect(store.document.content[0]?.attrs?.annotations).toEqual([
      result.created[0]?.annotation,
    ]);
  });

  it('统一创建合同允许批注空 BaseBlock', () => {
    const store = new FakeAnnotationStore();
    store.document = {
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: { id: 'root-1', annotations: [] },
        content: [{
          type: 'baseBlock',
          attrs: { id: 'block-1', blockType: 'base' },
          content: [],
        }],
      }],
    };

    const result = createMarkdownAnnotations({
      store,
      documentId: 'doc-1',
      expectedDocumentVersion: 3,
      drafts: [{ blockId: 'root-1', content: '空块批注' }],
      author: 'Reviewer',
      meta: { source: 'review', reviewRunId: 'review-1' },
      createId: () => 'annotation-empty',
      now: () => '2026-09-04T00:00:00.000Z',
    });

    expect(result.created[0]?.annotation).toMatchObject({
      id: 'annotation-empty',
      content: '空块批注',
      state: 'confirmed',
    });
    expect(store.document.content[0]?.content?.[0]?.content ?? []).toEqual([]);
  });

  it('在创建前拒绝过期文档版本', () => {
    const store = new FakeAnnotationStore();
    expect(() => createMarkdownAnnotations({
      store,
      documentId: 'doc-1',
      expectedDocumentVersion: 2,
      drafts: [{ blockId: 'root-1', content: '建议补充依据' }],
      author: 'Reviewer',
      meta: { source: 'review' },
    })).toThrow();
    expect(store.versionNumber).toBe(3);
  });
});
