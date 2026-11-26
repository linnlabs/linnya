// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization';
import { EDITOR_MESSAGE_CATALOG } from '../../../definitions/editorMessageCatalog';
import { createMarkdownDocumentExtensions } from '@linnya/markdown-document-core';
import type { DocumentReferencePresentation } from '@app/schemas';
import { createDocumentReferenceExtension } from '../orchestration/createDocumentReferenceExtension';
import { createDocumentReferenceNodeView } from '../ui/createDocumentReferenceNodeView';
import { createDocumentReferenceSuggestionView } from '../ui/createDocumentReferenceSuggestionView';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';
import { createEditorFocusBoundary } from '@/domains/editor/shared/focus';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearLocalizationRegistryForTest();
  document.body.replaceChildren();
});
const presentation: DocumentReferencePresentation = {
  documentId: 'target',
  title: 'Target',
  nodeType: 'document',
  path: 'workspace:/Target.md',
  status: 'available',
};
function port() {
  const changed = { current: () => {} };
  const value: DocumentReferenceUiPort = {
    getProjectId: () => 'project',
    query: async () => [],
    resolve: vi.fn(async () => presentation),
    readCached: () => presentation,
    subscribe(_documentId, listener) {
      changed.current = listener;
      return () => {
        changed.current = () => {};
      };
    },
    mountPreview: vi.fn(async () => () => {}),
    renderIcon: () => () => {},
    open: vi.fn(async () => {}),
    dispose: vi.fn(),
    report: vi.fn(),
  };

  return { value, changed };
}
describe('document reference interaction', () => {
  it('uses the production content schema and keeps reference IDs through JSON reload', () => {
    const f = port();
    const editor = new Editor({
      extensions: createMarkdownDocumentExtensions([createDocumentReferenceExtension(f.value)]),
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'documentReference', attrs: { documentId: 'target', referenceId: 'ref' } },
            ],
          },
        ],
      },
    });
    try {
      expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
        type: 'documentReference',
        attrs: { documentId: 'target', referenceId: 'ref' },
      });
      expect(editor.getMarkdown()).toContain('workspace:/Target.md');
    } finally {
      editor.destroy();
    }
    expect(f.value.dispose).toHaveBeenCalledOnce();
  });
  it('opens by stable identity on Enter, refreshes target state and unsubscribes on destruction', async () => {
    const f = port();
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    await vi.waitFor(() => expect(view.dom.textContent).toBe('Target'));
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(f.value.open).toHaveBeenCalledWith(presentation));
    vi.mocked(f.value.resolve).mockResolvedValue({
      ...presentation,
      title: null,
      path: null,
      status: 'outside_project',
    });
    f.changed.current();
    await vi.waitFor(() => expect(view.dom.textContent).toBe('其他项目的文档'));
    view.destroy();
    vi.mocked(f.value.resolve).mockClear();
    f.changed.current();
    expect(f.value.resolve).not.toHaveBeenCalled();
  });
  it('does not open a delayed preview after the pointer has already left', async () => {
    vi.useFakeTimers();
    const f = port();
    let resolve: ((value: DocumentReferencePresentation) => void) | undefined;
    vi.mocked(f.value.resolve).mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    view.dom.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.advanceTimersByTimeAsync(250);
    resolve?.(presentation);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.document-reference-preview')).toBeNull();
    expect(f.value.mountPreview).not.toHaveBeenCalled();
    view.destroy();
  });
  it('mounts the shared preview on hover and releases it on target invalidation', async () => {
    vi.useFakeTimers();
    const f = port(),
      dispose = vi.fn();
    vi.mocked(f.value.mountPreview).mockResolvedValue(dispose);
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    expect(f.value.mountPreview).toHaveBeenCalledWith(
      'target',
      expect.any(HTMLElement),
      expect.any(AbortSignal)
    );
    f.changed.current();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
    expect(document.querySelector('.document-reference-preview')).toBeNull();
    view.destroy();
  });
  it('shows contributed type icons and releases old icon trees as candidates change or close', () => {
    const renderIcon = vi.fn((_type: string, element: HTMLElement) => {
      element.textContent = 'icon';
      return vi.fn();
    });
    const view = createDocumentReferenceSuggestionView({ renderIcon });
    const command = vi.fn();
    const candidate = {
      documentId: 'slide',
      title: 'Slides',
      nodeType: 'slides',
      path: 'workspace:/Slides.slides',
      projectId: 'project',
    };
    view.onStart({ items: [candidate], command });
    expect(renderIcon).toHaveBeenCalledWith('slides', expect.any(HTMLElement));
    view.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Enter' }) });
    expect(command).toHaveBeenCalledWith(candidate);
    view.onUpdate({ items: [], command });
    expect(renderIcon.mock.results[0]?.value).toHaveBeenCalledOnce();
    view.onExit();
    expect(document.querySelector('[role=listbox]')).toBeNull();
  });

  it('shared preview controls remain in the editor focus boundary and close releases the mount', async () => {
    vi.useFakeTimers();
    const f = port(),
      leave = vi.fn(),
      dispose = vi.fn();
    const host = document.createElement('div'),
      external = document.createElement('button');
    document.body.append(host, external);
    const focus = createEditorFocusBoundary(host, leave);
    vi.mocked(f.value.mountPreview).mockImplementation(async (_id, element) => {
      const next = document.createElement('button');
      next.textContent = '下一页';
      next.onclick = () => {
        next.textContent = '第2页';
      };
      element.append(next);
      return dispose;
    });
    const view = createDocumentReferenceNodeView('target', 'ref', f.value, focus.registerPortal);
    host.append(view.dom);
    view.dom.focus();
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    const next = document.querySelector<HTMLButtonElement>('.document-reference-preview button');
    if (!next) throw new Error('Preview control is missing');
    next.focus();
    next.click();
    expect(next.textContent).toBe('第2页');
    expect(leave).not.toHaveBeenCalled();
    external.focus();
    expect(leave).toHaveBeenCalledOnce();
    focus.destroy();
    view.destroy();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('aborts pending shared mounts when the pointer leaves and releases a late disposer', async () => {
    vi.useFakeTimers();
    const f = port(),
      dispose = vi.fn();
    let finish: ((value: () => void) => void) | undefined;
    vi.mocked(f.value.mountPreview).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    const signal = vi.mocked(f.value.mountPreview).mock.calls[0][2];
    view.dom.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.advanceTimersByTimeAsync(200);
    expect(signal.aborted).toBe(true);
    finish?.(dispose);
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
    view.destroy();
  });
  it('编辑表面先销毁时，关闭仍聚焦的浮层不能反向触发迟到保存', async () => {
    vi.useFakeTimers();
    const f = port(),
      leave = vi.fn(),
      host = document.createElement('div');
    document.body.append(host);
    const focus = createEditorFocusBoundary(host, leave),
      view = createDocumentReferenceNodeView('target', 'ref', f.value, focus.registerPortal);
    host.append(view.dom);
    view.dom.focus();
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    const popup = document.querySelector<HTMLElement>('.document-reference-preview');
    if (!popup) throw new Error('Preview is missing');
    popup.tabIndex = 0;
    popup.focus();
    expect(leave).not.toHaveBeenCalled();
    focus.destroy();
    view.destroy();
    expect(leave).not.toHaveBeenCalled();
    expect(document.querySelector('.document-reference-preview')).toBeNull();
  });
  it('英文界面显示英文标签与预览名称，不再出现中文', async () => {
    registerMessageCatalogs(EDITOR_MESSAGE_CATALOG);
    useLocalizationStore().setCurrentLocale('en-US');
    vi.useFakeTimers();
    const f = port();
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, title: null });
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    expect(view.dom.textContent).toBe('Document');
    await vi.advanceTimersByTimeAsync(0);
    expect(view.dom.textContent).toBe('Document');
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, title: null, status: 'deleted' });
    f.changed.current();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.dom.textContent).toBe('Deleted document');
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, title: null, status: 'outside_project' });
    f.changed.current();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.dom.textContent).toBe('Document in another project');
    expect(view.dom.getAttribute('aria-label')).toBe('Document in another project');
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('.document-reference-preview')?.getAttribute('aria-label')).toBe(
      'Document preview'
    );
    view.destroy();
  });
  it('切换界面语言时，已显示的通用标签随之重画；销毁后不再更新', async () => {
    registerMessageCatalogs(EDITOR_MESSAGE_CATALOG);
    const f = port();
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, title: null, status: 'deleted' });
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    await vi.waitFor(() => expect(view.dom.textContent).toBe('文档已删除'));
    const store = useLocalizationStore();
    store.setCurrentLocale('en-US');
    await nextTick();
    expect(view.dom.textContent).toBe('Deleted document');
    expect(view.dom.getAttribute('aria-label')).toBe('Deleted document');
    store.setCurrentLocale('zh-CN');
    await nextTick();
    expect(view.dom.textContent).toBe('文档已删除');
    view.destroy();
    store.setCurrentLocale('en-US');
    await nextTick();
    expect(view.dom.textContent).toBe('文档已删除');
  });
  it('预览挂载失败时浮层里给可读提示，内部原因只交给日志', async () => {
    vi.useFakeTimers();
    const f = port(),
      failure = new Error('IPC channel workspace:preview rejected: SQLITE_BUSY');
    vi.mocked(f.value.mountPreview).mockRejectedValue(failure);
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    const panel = document.querySelector('.document-reference-preview');
    expect(panel?.textContent).toBe('无法预览此文档，请稍后重试。');
    expect(panel?.textContent).not.toContain('SQLITE_BUSY');
    expect(f.value.report).toHaveBeenCalledWith(failure);
    view.destroy();
  });
  it('预览浮层已被关闭或被取消时，迟到的失败不再往里写提示', async () => {
    vi.useFakeTimers();
    const f = port();
    let fail: (reason: Error) => void = () => {};
    vi.mocked(f.value.mountPreview).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const view = createDocumentReferenceNodeView('target', 'ref', f.value);
    document.body.append(view.dom);
    view.dom.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(400);
    view.dom.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.advanceTimersByTimeAsync(200);
    fail(new Error('late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.document-reference-preview')).toBeNull();
    expect(f.value.report).not.toHaveBeenCalled();
    view.destroy();
  });
});
