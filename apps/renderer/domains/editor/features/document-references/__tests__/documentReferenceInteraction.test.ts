// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createMarkdownDocumentExtensions } from '@linnya/markdown-document-core';
import type { DocumentReferencePresentation, DocumentPreviewResult } from '@app/schemas';
import { createDocumentReferenceExtension } from '../orchestration/createDocumentReferenceExtension';
import { createDocumentReferenceNodeView } from '../ui/createDocumentReferenceNodeView';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
const presentation: DocumentReferencePresentation = { documentId: 'target', title: 'Target', nodeType: 'document', path: 'workspace:/Target.md', status: 'available' };
function port() {
  const changed = { current: () => {} };
  const value: DocumentReferenceUiPort = { getProjectId: () => 'project', query: async () => [], resolve: vi.fn(async () => presentation), readCached: () => presentation,
    subscribe(_documentId, listener) { changed.current = listener; return () => { changed.current = () => {}; }; },
    preview: vi.fn(async (): Promise<DocumentPreviewResult> => ({ documentId: 'target', title: 'Target', nodeType: 'document', status: 'ready', content: { revisionKey: '1', summary: 'Summary' } })), open: vi.fn(async () => {}), renderDetail: vi.fn(async () => () => {}), dispose: vi.fn(), report: vi.fn() };
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
});
