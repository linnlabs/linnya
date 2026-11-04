// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createMarkdownDocumentExtensions } from '@linnya/markdown-document-core';
import type { DocumentReferencePresentation, DocumentPreviewResult } from '@app/schemas';
import { createDocumentReferenceExtension } from '../orchestration/createDocumentReferenceExtension';
import { createDocumentReferenceNodeView } from '../ui/createDocumentReferenceNodeView';
import { createDocumentReferenceSuggestionView } from '../ui/createDocumentReferenceSuggestionView';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';
import { createEditorFocusBoundary } from '@/domains/editor/shared/focus';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
const presentation: DocumentReferencePresentation = { documentId: 'target', title: 'Target', nodeType: 'document', path: 'workspace:/Target.md', status: 'available' };
function port() {
  const changed = { current: () => {} };
  const value: DocumentReferenceUiPort = { getProjectId: () => 'project', query: async () => [], resolve: vi.fn(async () => presentation), readCached: () => presentation,
    subscribe(_documentId, listener) { changed.current = listener; return () => { changed.current = () => {}; }; },
    preview: vi.fn(async (): Promise<DocumentPreviewResult> => ({ documentId: 'target', title: 'Target', nodeType: 'document', status: 'ready', content: { revisionKey: '1', summary: 'Summary' } })), renderIcon: () => () => {}, readDetailRenderer: () => null, recoveryAction: () => null, open: vi.fn(async () => {}), renderDetail: vi.fn(async () => () => {}), dispose: vi.fn(), report: vi.fn() };
  return { value, changed };
}
describe('document reference interaction', () => {
  it('uses the production content schema and keeps reference IDs through JSON reload', () => {
    const f = port(); const editor = new Editor({ extensions: createMarkdownDocumentExtensions([createDocumentReferenceExtension(f.value)]), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'documentReference', attrs: { documentId: 'target', referenceId: 'ref' } }] }] } });
    try { expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({ type: 'documentReference', attrs: { documentId: 'target', referenceId: 'ref' } }); expect(editor.getMarkdown()).toContain('workspace:/Target.md'); } finally { editor.destroy(); }
    expect(f.value.dispose).toHaveBeenCalledOnce();
  });
  it('opens by stable identity on Enter, refreshes target state and unsubscribes on destruction', async () => {
    const f = port(); const view = createDocumentReferenceNodeView('target', 'ref', f.value); document.body.append(view.dom); await vi.waitFor(() => expect(view.dom.textContent).toBe('Target'));
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await vi.waitFor(() => expect(f.value.open).toHaveBeenCalledWith(presentation));
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, title: null, path: null, status: 'outside_project' }); f.changed.current(); await vi.waitFor(() => expect(view.dom.textContent).toBe('其他项目的文档'));
    view.destroy(); vi.mocked(f.value.resolve).mockClear(); f.changed.current(); expect(f.value.resolve).not.toHaveBeenCalled();
  });
  it('does not open a delayed preview after the pointer has already left', async () => {
    vi.useFakeTimers(); const f = port(); let resolve: ((value: DocumentReferencePresentation) => void) | undefined;
    vi.mocked(f.value.resolve).mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = createDocumentReferenceNodeView('target', 'ref', f.value); document.body.append(view.dom); view.dom.dispatchEvent(new MouseEvent('mouseenter')); await vi.advanceTimersByTimeAsync(400);
    view.dom.dispatchEvent(new MouseEvent('mouseleave')); await vi.advanceTimersByTimeAsync(250); resolve?.(presentation); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('.document-reference-preview')).toBeNull(); expect(f.value.preview).not.toHaveBeenCalled(); view.destroy();
  });
  it('expands detail when entering the preview and releases it on a plugin availability change', async () => {
    vi.useFakeTimers(); const f = port(); const dispose = vi.fn();
    vi.mocked(f.value.preview).mockResolvedValue({ documentId: 'target', title: 'Target', nodeType: 'document', status: 'ready', content: { revisionKey: '1', summary: 'Summary', detail: { format: 'markdown', text: '# Full detail' } } });
    vi.mocked(f.value.renderDetail).mockResolvedValue(dispose);
    const view = createDocumentReferenceNodeView('target', 'ref', f.value); document.body.append(view.dom);
    view.dom.dispatchEvent(new MouseEvent('mouseenter')); await vi.advanceTimersByTimeAsync(400);
    const popup = document.querySelector('.document-reference-preview');
    expect(f.value.renderDetail).not.toHaveBeenCalled(); popup?.dispatchEvent(new MouseEvent('mouseenter')); await Promise.resolve();
    expect(f.value.renderDetail).toHaveBeenCalledWith(expect.any(HTMLElement), '# Full detail');
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, status: 'plugin_unavailable' }); f.changed.current(); await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce(); expect(document.querySelector('.document-reference-preview')).toBeNull(); view.destroy();
  });
  it('offers recovery only on user activation and opens the original stable document after enabling', async () => {
    const f = port(); const activate = vi.fn(async () => { vi.mocked(f.value.resolve).mockResolvedValue(presentation); });
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, status: 'plugin_unavailable' });
    f.value.recoveryAction = () => ({ label: '启用插件', activate });
    const view = createDocumentReferenceNodeView('target', 'ref', f.value); document.body.append(view.dom);
    view.dom.click(); await vi.waitFor(() => expect(document.querySelector('.document-reference-preview button')?.textContent).toBe('启用插件'));
    expect(activate).not.toHaveBeenCalled(); expect(f.value.open).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('.document-reference-preview button')?.click();
    await vi.waitFor(() => expect(f.value.open).toHaveBeenCalledWith(presentation)); expect(activate).toHaveBeenCalledOnce(); view.destroy();
  });

  it('shows contributed type icons and releases old icon trees as candidates change or close', () => {
    const renderIcon = vi.fn((_type: string, element: HTMLElement) => { element.textContent = 'icon'; return vi.fn(); });
    const view = createDocumentReferenceSuggestionView({ renderIcon }); const command = vi.fn();
    const candidate = { documentId: 'slide', title: 'Slides', nodeType: 'slides', path: 'workspace:/Slides.slides', projectId: 'project' };
    view.onStart({ items: [candidate], command }); expect(renderIcon).toHaveBeenCalledWith('slides', expect.any(HTMLElement));
    view.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Enter' }) }); expect(command).toHaveBeenCalledWith(candidate);
    view.onUpdate({ items: [], command }); expect(renderIcon.mock.results[0]?.value).toHaveBeenCalledOnce();
    view.onExit(); expect(document.querySelector('[role=listbox]')).toBeNull();
  });

  it('mounts a contributed readonly detail only on expansion and disposes it when leaving', async () => {
    vi.useFakeTimers(); const f = port(); const dispose = vi.fn(); const mount = vi.fn(async (element: HTMLElement) => { element.textContent = 'Readonly pages'; return dispose; });
    f.value.readDetailRenderer = () => mount;
    const view = createDocumentReferenceNodeView('target', 'ref', f.value); document.body.append(view.dom);
    view.dom.dispatchEvent(new MouseEvent('mouseenter')); await vi.advanceTimersByTimeAsync(400);
    expect(mount).not.toHaveBeenCalled(); const popup = document.querySelector('.document-reference-preview'); popup?.dispatchEvent(new MouseEvent('mouseenter')); await Promise.resolve();
    expect(document.body.textContent).toContain('Readonly pages'); expect(mount).toHaveBeenCalledOnce();
    popup?.dispatchEvent(new MouseEvent('mouseleave')); await vi.advanceTimersByTimeAsync(200); expect(dispose).toHaveBeenCalledOnce(); view.destroy();
  });

  it('焦点进入外置预览的展开和只读翻页控件仍属于同一编辑，真正移出才通知保存', async () => {
    vi.useFakeTimers(); const f = port(), leave = vi.fn(), dispose = vi.fn();
    const host = document.createElement('div'), external = document.createElement('button'); document.body.append(host, external);
    const focus = createEditorFocusBoundary(host, leave);
    f.value.readDetailRenderer = () => async element => {
      const next = document.createElement('button'); next.textContent = '下一页'; next.onclick = () => { next.textContent = '第2页'; }; element.append(next); return dispose;
    };
    const view = createDocumentReferenceNodeView('target', 'ref', f.value, focus.registerPortal); host.append(view.dom); view.dom.focus();
    view.dom.dispatchEvent(new MouseEvent('mouseenter')); await vi.advanceTimersByTimeAsync(400);
    const expand = document.querySelector<HTMLButtonElement>('.document-reference-preview button');
    if (!expand) throw new Error('Preview expansion is missing');
    expand.focus(); expect(leave).not.toHaveBeenCalled(); expand.click(); await Promise.resolve();
    const next = document.querySelector<HTMLButtonElement>('.document-reference-detail button');
    if (!next) throw new Error('Readonly owner control is missing');
    next.focus(); next.click(); expect(next.textContent).toBe('第2页'); expect(leave).not.toHaveBeenCalled();
    external.focus(); expect(leave).toHaveBeenCalledOnce();
    focus.destroy(); view.destroy(); expect(dispose).toHaveBeenCalledOnce();
  });

  it('插件恢复按钮不会在激活前结束编辑，关闭仍聚焦浮层只通知一次', async () => {
    const f = port(), leave = vi.fn(), host = document.createElement('div'); document.body.append(host);
    const focus = createEditorFocusBoundary(host, leave);
    vi.mocked(f.value.resolve).mockResolvedValue({ ...presentation, status: 'plugin_unavailable' });
    const activate = vi.fn(async () => { vi.mocked(f.value.resolve).mockResolvedValue(presentation); });
    f.value.recoveryAction = () => ({ label: '启用插件', activate });
    const view = createDocumentReferenceNodeView('target', 'ref', f.value, focus.registerPortal); host.append(view.dom); view.dom.focus(); view.dom.click();
    await vi.waitFor(() => expect(document.querySelector('.document-reference-preview button')).not.toBeNull());
    const recovery = document.querySelector<HTMLButtonElement>('.document-reference-preview button');
    if (!recovery) throw new Error('Recovery action is missing');
    recovery.focus(); expect(leave).not.toHaveBeenCalled(); recovery.click();
    await vi.waitFor(() => expect(f.value.open).toHaveBeenCalledWith(presentation));
    expect(activate).toHaveBeenCalledOnce(); expect(leave).toHaveBeenCalledOnce(); expect(document.querySelector('.document-reference-preview')).toBeNull();
    view.destroy(); focus.destroy(); expect(leave).toHaveBeenCalledOnce();
  });

  it('编辑表面先销毁时，关闭仍聚焦的浮层不能反向触发迟到保存', async () => {
    vi.useFakeTimers(); const f = port(), leave = vi.fn(), host = document.createElement('div'); document.body.append(host);
    const focus = createEditorFocusBoundary(host, leave), view = createDocumentReferenceNodeView('target', 'ref', f.value, focus.registerPortal); host.append(view.dom);
    view.dom.focus(); view.dom.dispatchEvent(new MouseEvent('mouseenter')); await vi.advanceTimersByTimeAsync(400);
    const popup = document.querySelector<HTMLElement>('.document-reference-preview'); if (!popup) throw new Error('Preview is missing');
    popup.tabIndex = 0; popup.focus(); expect(leave).not.toHaveBeenCalled();
    focus.destroy(); view.destroy(); expect(leave).not.toHaveBeenCalled(); expect(document.querySelector('.document-reference-preview')).toBeNull();
  });

});
