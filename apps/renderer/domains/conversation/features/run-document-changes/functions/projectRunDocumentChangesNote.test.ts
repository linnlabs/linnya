import { describe, expect, it } from 'vitest';
import type { RunDocumentChangeItem, RunDocumentChangeStatus } from '../definitions/runDocumentChanges';
import { projectRunDocumentChangesNote, resolveRunDocumentChangePrimaryIntent } from './projectRunDocumentChangesNote';
import { resolveRunDocumentChangeActionKey, resolveRunDocumentChangeStateKey } from './resolveRunDocumentChangeLabels';

function item(documentId: string, status: RunDocumentChangeStatus = { kind: 'none' }, extra: Partial<RunDocumentChangeItem> = {}): RunDocumentChangeItem {
  return {
    documentId, projectId: 'p', parentId: null, title: documentId, iconComponent: {}, iconClass: '',
    activeDocumentType: 'document', deleted: false, created: false, bySubrunOnly: false, status,
    action: status.kind === 'pending' ? 'review' : status.kind === 'applied' ? 'history' : null,
    ...extra,
  };
}

describe('本轮改动的尾注', () => {
  it('没有改动不出尾注；只改一份时一行写全', () => {
    expect(projectRunDocumentChangesNote([])).toBeNull();
    const single = item('a', { kind: 'pending', count: 3 });
    expect(projectRunDocumentChangesNote([single])).toMatchObject({ single, pendingDocumentCount: 1 });
  });

  it('待审阅的排最前，其余保持最近改动在前', () => {
    const note = projectRunDocumentChangesNote([
      item('recent'), item('pending-old', { kind: 'pending', count: 1 }), item('applied', { kind: 'applied' }),
    ]);
    expect(note?.items.map(entry => entry.documentId)).toEqual(['pending-old', 'recent', 'applied']);
    expect(note).toMatchObject({ single: null, pendingDocumentCount: 1 });
  });

  it('整行点击：待审阅进审阅，其余打开；已删除优先显示删除且没有按钮', () => {
    expect(resolveRunDocumentChangePrimaryIntent(item('a', { kind: 'pending', count: 1 }))).toBe('review');
    expect(resolveRunDocumentChangePrimaryIntent(item('b', { kind: 'applied' }))).toBe('open');
    const deleted = item('c', { kind: 'applied' }, { deleted: true });
    expect(resolveRunDocumentChangeStateKey(deleted)).toEqual({ key: 'conversation.runChanges.deleted' });
    expect(resolveRunDocumentChangeActionKey(deleted)).toBeNull();
    expect(resolveRunDocumentChangeStateKey(item('d', { kind: 'pending', count: 2 })))
      .toEqual({ key: 'conversation.runChanges.pendingCount', params: { count: 2 } });
  });
});
