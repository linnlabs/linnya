import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createDocumentActionContext, type DocumentActionTarget } from './createDocumentActionContext';
import { selectDocumentAction } from './selectDocumentAction';
import { createKnowledgeDocumentActions } from '../builtin/knowledge/orchestration/knowledgeDocumentActions';
const identity = { projectId: 'project-a', documentId: 'document-a', activeDocumentType: 'editor', displayName: 'A' };
describe('frozen document action scope', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('另一个活动文档不参与目标读取；菜单冻结身份，上传前后不会改读B', async () => {
    const active = vi.fn(() => null);
    const persisted = vi.fn(async (target: DocumentActionTarget) => `saved:${target.documentId}`);
    const context = createDocumentActionContext(identity, {
      readPresentation: async target => ({ documentId: target.documentId, status: 'available', nodeType: 'document', title: 'A', path: '/A.md' }),
      readActiveMarkdown: active, readPersistedMarkdown: persisted,
    });
    const action = createKnowledgeDocumentActions(vi.fn());
    expect(await selectDocumentAction(action.menu, 'export-markdown', context)).toBe(false);
    expect(active).not.toHaveBeenCalled();
    expect(await selectDocumentAction(action.menu, 'add-to-kb', context)).toBe(true);
    expect(action.selection.value).toMatchObject({ projectId: identity.projectId,
      documentId: identity.documentId, displayName: 'A', markdown: 'saved:document-a' });
    expect(persisted).toHaveBeenCalledWith(identity);
    expect(Object.isFrozen(context)).toBe(true);
    action.cancel();
    expect(action.selection.value).toBeNull();
  });
  it('同一目标使用冻结的未保存快照；越界/取消拒绝，不挂出迟到弹窗', async () => {
    let complete: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const persisted = vi.fn(async () => 'persisted');
    let markdown = 'unsaved:A';
    const context = createDocumentActionContext(identity, {
      readPresentation: async target => { await pending; return { documentId: target.documentId, status: 'available', title: 'A', nodeType: 'document', path: '/A' }; },
      readActiveMarkdown: () => markdown, readPersistedMarkdown: persisted,
    });
    const action = createKnowledgeDocumentActions(vi.fn());
    const loading = action.menu.select('add-to-kb', context);
    markdown = 'unsaved:B';
    complete?.(); await loading;
    expect(action.selection.value?.markdown).toBe('unsaved:A');
    expect(persisted).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(context.readMarkdownSnapshot?.(controller.signal)).rejects.toThrow();
    const outside = createDocumentActionContext(identity, {
      readPresentation: async () => ({ documentId: 'document-a', status: 'outside_project', title: null, nodeType: null, path: null }),
      readActiveMarkdown: () => null, readPersistedMarkdown: persisted,
    });
    await expect(outside.readMarkdownSnapshot?.(new AbortController().signal)).rejects.toThrow('其他项目');
    expect(persisted).not.toHaveBeenCalled();
    expect(createDocumentActionContext({ ...identity, activeDocumentType: 'slides' }, {
      readPresentation: vi.fn(), readActiveMarkdown: vi.fn(), readPersistedMarkdown: vi.fn(),
    }).readMarkdownSnapshot).toBeUndefined();
  });
  it('项目切换或插件停用取消读取，不产生迟到选择或未处理拒绝', async () => {
    let complete: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const onError = vi.fn();
    const action = createKnowledgeDocumentActions(onError);
    const context = createDocumentActionContext(identity, {
      readPresentation: async target => { await pending; return { documentId: target.documentId,
        status: 'available', title: 'A', nodeType: 'document', path: '/A' }; },
      readActiveMarkdown: () => null, readPersistedMarkdown: vi.fn(),
    });
    const reading = action.menu.select('add-to-kb', context);
    action.cancel();
    complete?.();
    await reading;
    expect(action.selection.value).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
