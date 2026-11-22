import { describe, expect, it } from 'vitest';
import { DocumentStatus } from '../../domain/document';
import {
  ORPHANED_UNSAVED_DOCUMENT_MESSAGE,
  markOrphanedUnsavedKnowledgeDocuments,
} from './markInterruptedKnowledgeDocuments';

type Row = { id: string; kbId: string; status: DocumentStatus; errorMessage?: string };

function repositories(rows: Row[], options: { saved?: string[]; originals?: string[]; rejectUpdate?: string } = {}) {
  const updates: { id: string; status: DocumentStatus; message?: string }[] = [];
  return {
    updates,
    rows,
    input: {
      metadata: {
        async getAllDocuments() {
          return rows.map(row => ({ ...row, filename: `${row.id}.md` })) as never;
        },
        async updateDocumentStatus(id: string, status: DocumentStatus, message?: string) {
          if (id === options.rejectUpdate) return false;
          updates.push({ id, status, message });
          const row = rows.find(item => item.id === id);
          if (row) Object.assign(row, { status, errorMessage: message });
          return Boolean(row);
        },
      },
      sot: { async listAllDocumentIds() { return options.saved ?? []; } },
      originals: {
        async getPath(kbId: string, docId: string) {
          return options.originals?.includes(docId) ? `/originals/${kbId}/${docId}` : undefined;
        },
      },
    },
  };
}

describe('激活时收尾上一个进程留下的未完成文档', () => {
  it('没有保存任何内容的等待中/处理中文档标为失败，并提示重新上传', async () => {
    const repo = repositories([
      { id: 'pending-empty', kbId: 'kb', status: DocumentStatus.PENDING },
      { id: 'processing-empty', kbId: 'kb', status: DocumentStatus.PROCESSING },
    ]);
    expect(await markOrphanedUnsavedKnowledgeDocuments(repo.input)).toEqual(['pending-empty', 'processing-empty']);
    expect(repo.rows.map(row => row.status)).toEqual([DocumentStatus.FAILED, DocumentStatus.FAILED]);
    expect(repo.rows[0]?.errorMessage).toBe(ORPHANED_UNSAVED_DOCUMENT_MESSAGE);
    expect(ORPHANED_UNSAVED_DOCUMENT_MESSAGE).toMatch(/重新上传/u);
  });

  it('已保存内容或原文的未完成文档不动：可能其实已完成，由一致性维护判断', async () => {
    const repo = repositories([
      { id: 'pending-saved', kbId: 'kb', status: DocumentStatus.PENDING },
      { id: 'processing-original', kbId: 'kb', status: DocumentStatus.PROCESSING },
      { id: 'pending-empty', kbId: 'kb', status: DocumentStatus.PENDING },
    ], { saved: ['pending-saved'], originals: ['processing-original'] });
    expect(await markOrphanedUnsavedKnowledgeDocuments(repo.input)).toEqual(['pending-empty']);
    expect(repo.rows.map(row => row.status)).toEqual([
      DocumentStatus.PENDING, DocumentStatus.PROCESSING, DocumentStatus.FAILED,
    ]);
  });

  it('已完成、已失败的文档与空库都不写任何状态', async () => {
    const finished = repositories([
      { id: 'done', kbId: 'kb', status: DocumentStatus.COMPLETED },
      { id: 'failed', kbId: 'kb', status: DocumentStatus.FAILED, errorMessage: 'original reason' },
    ]);
    expect(await markOrphanedUnsavedKnowledgeDocuments(finished.input)).toEqual([]);
    expect(finished.updates).toEqual([]);
    expect(finished.rows[1]?.errorMessage).toBe('original reason');
    const empty = repositories([]);
    expect(await markOrphanedUnsavedKnowledgeDocuments(empty.input)).toEqual([]);
    expect(empty.updates).toEqual([]);
  });

  it('状态写入未生效时失败，不假装已收尾', async () => {
    const repo = repositories([{ id: 'stuck', kbId: 'kb', status: DocumentStatus.PENDING }], { rejectUpdate: 'stuck' });
    await expect(markOrphanedUnsavedKnowledgeDocuments(repo.input)).rejects.toThrow('stuck');
  });
});
