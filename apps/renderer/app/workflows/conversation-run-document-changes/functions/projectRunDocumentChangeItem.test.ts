import { describe, expect, it } from 'vitest';
import type { ConversationRunDocumentChange } from '@app/schemas';
import { projectRunDocumentChangeItem, type RunDocumentChangeTypeFacts } from './projectRunDocumentChangeItem';

const Icon = { name: 'Icon' };

function change(overrides: Partial<ConversationRunDocumentChange>): ConversationRunDocumentChange {
  return {
    document_id: 'doc', project_id: 'p', node_type: 'document', title: '报告', parent_id: null,
    presence: 'present', created: false, actor: 'run', last_recorded_at: 1, pending_revision_count: null,
    ...overrides,
  };
}

const markdown: RunDocumentChangeTypeFacts = { activeDocumentType: 'document', iconComponent: Icon, iconClass: '', hasDocumentHistory: false };
const slides: RunDocumentChangeTypeFacts = { activeDocumentType: 'slides', iconComponent: Icon, iconClass: '', hasDocumentHistory: true };

describe('改动文档的状态只按它自己的类型', () => {
  it('Markdown 有待审阅修订时进审阅；处理完后没有状态', () => {
    expect(projectRunDocumentChangeItem(change({ pending_revision_count: 4 }), markdown))
      .toMatchObject({ status: { kind: 'pending', count: 4 }, action: 'review' });
    expect(projectRunDocumentChangeItem(change({ pending_revision_count: 0 }), markdown))
      .toMatchObject({ status: { kind: 'none' }, action: null });
  });

  it('有文档历史的类型改了已有文档是已生效，进历史；新建的只打开', () => {
    expect(projectRunDocumentChangeItem(change({ node_type: 'slides' }), slides))
      .toMatchObject({ status: { kind: 'applied' }, action: 'history' });
    expect(projectRunDocumentChangeItem(change({ node_type: 'slides', created: true }), slides))
      .toMatchObject({ status: { kind: 'none' }, action: null, created: true });
  });

  it('已删除或类型未启用的文档不给状态和按钮；只标记子任务独占的改动', () => {
    expect(projectRunDocumentChangeItem(change({ presence: 'deleted', pending_revision_count: 2 }), markdown))
      .toMatchObject({ deleted: true, status: { kind: 'none' }, action: null });
    expect(projectRunDocumentChangeItem(change({ actor: 'subrun' }), { ...slides, activeDocumentType: null }))
      .toMatchObject({ activeDocumentType: null, bySubrunOnly: true });
    expect(projectRunDocumentChangeItem(change({ actor: 'mixed' }), markdown).bySubrunOnly).toBe(false);
  });
});
