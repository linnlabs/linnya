import { describe, expect, it } from 'vitest';
import type { DocumentVersion } from '../../document-storage';
import type { MarkdownDocJson } from '../../normalization/runtime';
import { applyMarkdownAnnotationChanges } from './applyMarkdownAnnotationChanges';
import type { MarkdownAnnotationMutationStore } from './applyMarkdownAnnotationChanges';

const originalAnnotation = {
  id: 'annotation-old',
  content: '原批注',
  author: 'User',
  state: 'confirmed' as const,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  resolvedAt: null,
  replies: [],
  meta: { source: 'manual' as const },
};

class FakeMutationStore implements MarkdownAnnotationMutationStore {
  document: MarkdownDocJson = {
    type: 'doc',
    content: [{
      type: 'rootBlock',
      attrs: { id: 'root-1', annotations: [originalAnnotation] },
      content: [{ type: 'paragraphBlock', content: [{ type: 'text', text: '正文' }] }],
    }],
  };
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

describe('applyMarkdownAnnotationChanges', () => {
  it('在一个文档版本中同时创建、编辑和删除批注', () => {
    const store = new FakeMutationStore();
    const edited = { ...originalAnnotation, content: '修改后' };
    const result = applyMarkdownAnnotationChanges({
      store,
      documentId: 'doc-1',
      creations: [{ blockId: 'root-1', content: '新增批注' }],
      updates: [{ blockId: 'root-1', annotation: edited }],
      deletions: [],
      author: 'AI',
      meta: { source: 'agent', runId: 'run-1' },
      createId: () => 'annotation-new',
      now: () => '2026-09-04T01:00:00.000Z',
    });

    expect(result.version?.version_number).toBe(4);
    expect(store.document.content[0]?.attrs?.annotations).toEqual([
      edited,
      expect.objectContaining({ id: 'annotation-new', state: 'confirmed' }),
    ]);

    const deletion = applyMarkdownAnnotationChanges({
      store,
      documentId: 'doc-1',
      creations: [],
      updates: [],
      deletions: [
        { blockId: 'root-1', annotationId: 'annotation-old' },
        { blockId: 'root-1', annotationId: 'annotation-new' },
      ],
      author: 'AI',
      meta: { source: 'agent' },
    });
    expect(deletion.version?.version_number).toBe(5);
    expect(store.document.content[0]?.attrs?.annotations).toEqual([]);
  });
});
