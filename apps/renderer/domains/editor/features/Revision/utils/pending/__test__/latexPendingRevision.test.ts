// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, h, nextTick, ref } from 'vue';
import { Editor as VueEditor, EditorContent } from '@tiptap/vue-3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MarkdownRevisionCommit, MarkdownRevisionSnapshot } from '@app/schemas';
import { importMarkdownToDocJson } from 'src/domains/markdown';

vi.hoisted(() => Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), commit: vi.fn() }));
vi.mock('@/shared/ipc/workspaceGateway', () => ({ workspaceGateway: { 'read-document': mocks.read, 'commit-markdown-revision': mocks.commit } }));
vi.mock('../../../../../../../shared/services/markdownService', () => ({ parseMarkdown: vi.fn(), parseMarkdownToBlocksByStreaming: vi.fn() }));
vi.mock('../../../../../services/markdownRuntime/parser', async () => {
  const { parseMarkdownToBlocksInNode } = await import('src/domains/markdown/features/normalization');
  return { parseMarkdownToBlockEvents: parseMarkdownToBlocksInNode };
});

import { getAllExtensions } from '../../../../../core/extensionRegistry';
import { beginMarkdownDocumentSession, loadMarkdownDocumentSession } from '../../../../document-session';
import { useRevisionStore } from '../../../useRevisionStore';
import { useLatexRevisionView } from '../../../../../blocks/LatexBlock/orchestration/useLatexRevisionView';
import { readRevisionIndicatorSummary } from '../../../readModel';
import { useLatexEditorStore } from '../../../../../blocks/LatexBlock/store/latexEditor';
import RevisionIndicator from '../../../ui/RevisionIndicator.vue';
import RevisionToolbar from '../../../ui/RevisionToolbar.vue';

const editors: Editor[] = [];
const formula = (source: string): JSONContent => ({ type: 'latexBlock', attrs: { id: 'formula-content', blockType: 'latex', latexSource: source } });
const documentOf = (content: JSONContent): JSONContent => ({ type: 'doc', content: [{ type: 'rootBlock', attrs: { id: 'formula-root' }, content: [content] }] });
const empty: JSONContent = { type: 'baseBlock', attrs: { id: 'empty-content', blockType: 'base' } };
const snapshot = (content: JSONContent, operation: 'insert' | 'update' | 'delete', markdown: string): MarkdownRevisionSnapshot => ({
  content, versionNumber: 1, pendingRevisions: [{ id: 'pending-formula', revision: 1, blockId: 'formula-root', newMarkdown: markdown,
    source: 'ai', operation, metaJson: JSON.stringify({ operation }), createdAt: 1, updatedAt: 1 }],
});
function createEditor() {
  setActivePinia(createPinia());
  const editor = new Editor({ extensions: getAllExtensions({ layoutManagerInstance: ref(null), findReplaceStore: null }), content: documentOf(empty) });
  editors.push(editor);
  return editor;
}
async function open(editor: Editor, data: MarkdownRevisionSnapshot) {
  mocks.read.mockResolvedValueOnce({ success: true, data });
  const session = beginMarkdownDocumentSession(editor, 'formula-document', { setDirty: vi.fn(), reportError: vi.fn() });
  await loadMarkdownDocumentSession(editor, session);
  return useRevisionStore(editor);
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });

it.each(['insert', 'update', 'delete'] as const)('%s：生产 schema 与真实 parser 预览、拒绝、接受和重开保持公式结构', async operation => {
  const editor = createEditor();
  const baseline = documentOf(operation === 'insert' ? empty : formula('x^2'));
  const markdown = operation === 'delete' ? '' : '$$\ny^2 + 1\n$$';
  const data = snapshot(baseline, operation, markdown);
  const store = await open(editor, data);
  const preview = editor.state.doc.firstChild?.firstChild;
  expect(preview?.type.name).toBe('latexBlock');
  expect(preview?.attrs.latexSource).toBe(operation === 'delete' ? 'x^2' : 'y^2 + 1');
  expect(preview?.marks).toEqual([]);
  expect(store.getCanonicalSession('formula-root')).toMatchObject({ projection: 'ready', diffStats: {
    insertCount: operation === 'delete' ? 0 : 1, deleteCount: operation === 'insert' ? 0 : 1,
  } });
  expect(store.readProjectionBaseline('formula-root')?.firstChild?.toJSON()).toEqual(editor.schema.nodeFromJSON(baseline).firstChild?.firstChild?.toJSON());

  const view = useLatexRevisionView(editor, ref('formula-root'));
  expect(view.pending.value).toBe(true);
  expect(view.canToggleBaseline.value).toBe(operation === 'update');
  if (operation === 'update') {
    view.toggleBaseline();
    expect(view.displaysBaseline.value).toBe(true);
    expect(view.baselineSource.value).toBe('x^2');
    view.toggleBaseline();
  }
  const reopened = createEditor();
  await open(reopened, data);
  expect(reopened.state.doc.firstChild?.firstChild?.attrs.latexSource).toBe(preview?.attrs.latexSource);

  const original = store.readBaseline().toJSON();
  mocks.commit.mockResolvedValueOnce({ success: true, data: { content: baseline, pendingRevisions: [], versionNumber: 2 } });
  await store.rejectAllRevisions('formula-root');
  const rejection: MarkdownRevisionCommit = mocks.commit.mock.calls[0][0];
  expect(rejection.baseline).toEqual(original);
  expect(store.canonicalPendingBlockCount.value).toBe(0);
  expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe(operation === 'insert' ? 'baseBlock' : 'latexBlock');

  await open(editor, data);
  const imported = operation === 'delete' ? documentOf(empty) : (await importMarkdownToDocJson(markdown)).docJson;
  if (!imported) throw new Error('公式导入失败');
  mocks.commit.mockResolvedValueOnce({ success: true, data: { content: imported, pendingRevisions: [], versionNumber: 3 } });
  await store.acceptAllRevisions('formula-root');
  expect(store.canonicalPendingBlockCount.value).toBe(0);
  expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe(operation === 'delete' ? 'baseBlock' : 'latexBlock');
  if (operation !== 'delete') expect(editor.state.doc.firstChild?.firstChild?.attrs.latexSource).toBe(preview?.attrs.latexSource);
  await open(editor, { content: imported, pendingRevisions: [], versionNumber: 3 });
  expect(store.canonicalPendingBlockCount.value).toBe(0);
  await nextTick();
});

it('相同公式不修改节点、不登记增删；多块提议保留原式与待处理计数，只可拒绝', async () => {
  const editor = createEditor();
  const baseline = documentOf(formula('x^2'));
  const store = await open(editor, snapshot(baseline, 'update', '$$\nx^2\n$$'));
  expect(store.getCanonicalSession('formula-root')?.diffStats).toBeUndefined();
  expect(store.activeRevisionCount.value).toBe(0);
  expect(editor.state.doc.firstChild?.firstChild?.attrs.latexSource).toBe('x^2');

  await open(editor, snapshot(baseline, 'update', '$$\ny^2\n$$\n\nextra paragraph'));
  expect(store.getCanonicalSession('formula-root')?.projection).toBe('failed');
  expect(store.canonicalPendingBlockCount.value).toBe(1);
  expect(store.readBaseline().firstChild?.firstChild?.attrs.latexSource).toBe('x^2');
  expect(editor.state.doc.firstChild?.firstChild?.attrs.latexSource).toBe('x^2');
  expect(readRevisionIndicatorSummary(store.getCanonicalSession('formula-root')).projectionFailed).toBe(true);
  const container = document.createElement('div');
  const app = createApp({ render: () => h('div', [
    h(RevisionIndicator, { status: 'pending', forceVisible: true, projectionFailed: true }),
    h(RevisionToolbar, { editor, visible: true, blockId: 'formula-root', position: { top: 0, left: 0 } }),
  ]) });
  app.mount(container);
  try {
    expect(container.textContent).toContain('这条修改无法预览');
    expect(container.querySelector('.accept-btn')).toBeNull();
    expect(container.querySelector('.reject-btn')).not.toBeNull();
  } finally { app.unmount(); }
  await expect(store.acceptAllRevisions('formula-root')).rejects.toThrow('仅可拒绝');
  await expect(store.acceptAllRevisionsInDocument()).rejects.toThrow('仅可拒绝');
  expect(mocks.commit).not.toHaveBeenCalled();
  mocks.commit.mockResolvedValueOnce({ success: true, data: { content: baseline, pendingRevisions: [], versionNumber: 2 } });
  await store.rejectAllRevisions('formula-root');
  expect(store.canonicalPendingBlockCount.value).toBe(0);
});

it('真实 LatexBlockView 渲染提议和原式，Pending 期间点击公式不会打开编辑面板', async () => {
  setActivePinia(createPinia());
  const editor = new VueEditor({ extensions: getAllExtensions({ layoutManagerInstance: ref(null), findReplaceStore: null }), content: documentOf(empty) });
  editors.push(editor);
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render: () => h(EditorContent, { editor }) });
  app.mount(container);
  try {
    await open(editor, snapshot(documentOf(formula('x^2')), 'update', '$$\ny^2 + 1\n$$'));
    await nextTick();
    await nextTick();
    const view = editor.view.dom.querySelector('.latex-block-view');
    expect(view?.querySelector('.katex')).not.toBeNull();
    expect(view?.textContent).toContain('y');
    const toggle = view?.querySelector('button');
    if (!(toggle instanceof HTMLButtonElement)) throw new Error('缺少公式对照按钮');
    toggle.click();
    await nextTick();
    expect(view?.textContent).toContain('x');
    expect(view?.textContent).not.toContain('y');
    view?.querySelector('.latex-rendered-content')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(useLatexEditorStore().isPanelVisible).toBe(false);
  } finally { app.unmount(); container.remove(); }
});
