import { describe, expect, it, vi } from 'vitest';
import { createDocument, DocumentStatus } from '../../domain/document';
import { listKnowledgeDocumentsWithSource, readSavedKnowledgeContent } from './readSavedKnowledgeContent';

it('lists saved failed documents separately from source-less failures without loading document bodies', async () => {
  const failed = { ...createDocument('saved-failed', 'kb-a', '原件.md', 30), status: DocumentStatus.FAILED };
  const pending = createDocument('new-failed', 'kb-a', '另一篇.md', 30);
  const read = vi.fn(async () => 'full body');
  const result = await listKnowledgeDocumentsWithSource({
    getDocumentsInKnowledgeBase: async () => [failed, pending],
    getDocumentById: async () => failed,
    getSoTDocumentForAgent: read,
  }, { listAllDocumentIds: async () => [failed.id] }, 'kb-a');
  expect(result.map(({ id, hasSource, status }) => ({ id, hasSource, status }))).toEqual([
    { id: failed.id, hasSource: true, status: DocumentStatus.FAILED },
    { id: pending.id, hasSource: false, status: DocumentStatus.PENDING },
  ]);
  expect(read).not.toHaveBeenCalled();
});

describe('saved knowledge document reading', () => {
  it('checks library ownership before reading and returns the full source without a vector service', async () => {
    const doc = createDocument('doc-a', 'kb-a', '原件.md', 4096);
    const body = '保留的原始文字'.repeat(1000);
    const read = vi.fn(async () => body);
    const port = {
      getDocumentsInKnowledgeBase: async () => [doc],
      getDocumentById: async () => doc,
      getSoTDocumentForAgent: read,
    };
    await expect(readSavedKnowledgeContent(port, { kbId: 'kb-b', documentId: doc.id }, new AbortController().signal))
      .rejects.toThrow('文档不属于当前知识库');
    expect(read).not.toHaveBeenCalled();
    expect(await readSavedKnowledgeContent(port, { kbId: doc.kbId, documentId: doc.id }, new AbortController().signal))
      .toEqual({ documentId: doc.id, fileName: doc.filename, markdown: body });
  });

  it('rejects a late source result when its reader has closed', async () => {
    const doc = createDocument('doc-a', 'kb-a', '原件.md', 1);
    const controller = new AbortController();
    const port = {
      getDocumentsInKnowledgeBase: async () => [doc],
      getDocumentById: async () => doc,
      getSoTDocumentForAgent: async () => { controller.abort(); return 'late'; },
    };
    await expect(readSavedKnowledgeContent(port, { kbId: doc.kbId, documentId: doc.id }, controller.signal))
      .rejects.toThrow(/abort/i);
  });
});
