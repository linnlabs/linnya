// @vitest-environment jsdom
import { stripRevisionProjection } from '../../Revision/functions/revisionProjectionBaseline';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Mark, Node, type JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/vue-3';
import { loadDocumentJsonAtomically } from '../../../services/editorDocumentStateLoader';
import { createRenderVirtualizationPlugin, getRenderVirtualizationState, prepareInitialRenderVirtualizationState } from '../../RenderVirtualization/state/renderVirtualizationPlugin';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { RevisionMark } from '../../../extensions/revision/RevisionMark';
import { useRevisionStore } from '../../Revision/runtime';
import { beginMarkdownDocumentSession, loadMarkdownDocumentSession, refreshMarkdownDocumentSession, saveMarkdownDocumentSession, closeMarkdownDocumentSession } from '../index';
import { setFlag } from '../../../ui/services/editorFeatureFlags';
import type { MarkdownRevisionCommit, MarkdownRevisionSnapshot } from '@app/schemas';

const mocks = vi.hoisted(() => ({ read: vi.fn(), commit: vi.fn(), dirty: vi.fn(), report: vi.fn() }));
vi.mock('@/shared/ipc/workspaceGateway', () => ({ workspaceGateway: {
  'read-document': mocks.read, 'commit-markdown-revision': mocks.commit,
} }));
// jsdom 不提供 WASM URL 服务，使用同一解析器的正式 Node 加载端口，后续投影仍走真实实现。
vi.mock('../../../services/markdownRuntime/parser', async () => {
  const { parseMarkdownToBlocksInNode } = await import('src/domains/markdown/features/normalization');
  return { parseMarkdownToBlockEvents: parseMarkdownToBlocksInNode };
});
const presentationMarks = ['textColor', 'textHighlight'].map(name => Mark.create({ name,
  addAttributes: () => ({ color: { default: null } }),
  parseHTML: () => [{ tag: 'span' }], renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0] }));
const Bold = Mark.create({ name: 'bold', parseHTML: () => [{ tag: 'strong' }], renderHTML: () => ['strong', 0] });
const Root = Node.create({ name: 'rootBlock', group: 'block', content: '(baseBlock|table)',
  addAttributes: () => ({ id: { default: null }, annotations: { default: [] } }),
  parseHTML: () => [{ tag: 'section' }], renderHTML: ({ HTMLAttributes }) => ['section', HTMLAttributes, 0] });
const Base = Paragraph.extend({ name: 'baseBlock', addAttributes: () => ({ id: { default: null } }) });
const tableNodes = [
  { name: 'table', content: 'tableRow+', tag: 'table' },
  { name: 'tableRow', content: '(tableCell|tableHeader)+', tag: 'tr' },
  { name: 'tableCell', content: 'tableCellContentBlock+', tag: 'td' },
  { name: 'tableHeader', content: 'tableCellContentBlock+', tag: 'th' },
  { name: 'tableCellContentBlock', content: 'inline*', tag: 'p' },
].map(({ name, content, tag }) => Node.create({ name, content,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag }], renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0] }));
const doc = (texts: string[]): JSONContent => ({ type: 'doc', content: texts.map((text, index) => ({
  type: 'rootBlock', attrs: { id: `b${index}` }, content: [{ type: 'baseBlock', attrs: { id: `i${index}` }, content: [{ type: 'text', text }] }],
})) });
const pending = (text: string, count = 1, revision = 1): MarkdownRevisionSnapshot['pendingRevisions'] => Array.from({ length: count }, (_, index) => ({
  id: `p${index}`, revision, blockId: `b${index}`, newMarkdown: text, source: 'ai', operation: 'update',
  metaJson: null, createdAt: 1, updatedAt: revision,
}));
function snapshot(texts: string[], revisions = pending('suggestion'), versionNumber = 1): MarkdownRevisionSnapshot {
  return { content: doc(texts), pendingRevisions: revisions, versionNumber };
}
const editors: Editor[] = [];
function createEditor() {
  const editor = new Editor({ extensions: [Document.extend({ content: 'rootBlock+' }), Root, Base, Text, Bold, ...presentationMarks, RevisionMark, ...tableNodes], content: doc(['initial']) });
  editors.push(editor); return editor;
}
async function open(editor: Editor, data: MarkdownRevisionSnapshot, documentId = 'doc-a') {
  mocks.read.mockResolvedValueOnce({ success: true, data });
  const session = beginMarkdownDocumentSession(editor, documentId, { setDirty: mocks.dirty, reportError: mocks.report });
  await loadMarkdownDocumentSession(editor, session); return session;
}
function editBlock(editor: Editor, blockIndex: number, text: string) {
  let from = 2;
  for (let index = 0; index < blockIndex; index++) from += editor.state.doc.child(index).nodeSize;
  const inner = editor.state.doc.child(blockIndex).child(0);
  editor.view.dispatch(editor.state.tr.insertText(text, from, from + inner.content.size));
}
beforeEach(() => { vi.clearAllMocks(); setFlag('deferPendingProjectionForLargeDocuments', true); });
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });

it('切换到零 Pending 文档会清空计数、缓存和行内投影', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['baseline']));
  expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(1);
  await open(editor, snapshot(['clean B'], []), 'doc-b');
  expect(editor.state.doc.textContent).toBe('clean B');
  expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(0);
  expect(JSON.stringify(editor.getJSON())).not.toContain('revisionMark');
});

it('同一 Pending 的 revision 更新后重新投影，并保留 ID', async () => {
  const editor = createEditor();
  const texts = Array.from({ length: 100 }, () => 'baseline');
  await open(editor, snapshot(texts, pending('first version', 100)));
  const revision = useRevisionStore(editor);
  await revision.projectPendingRevisionsForBlocks(['b0']);
  mocks.read.mockResolvedValueOnce({ success: true, data: snapshot(texts, pending('second version', 100, 2)) });
  await refreshMarkdownDocumentSession(editor, 'doc-a');
  await revision.projectPendingRevisionsForBlocks(['b0']);
  expect(stripRevisionProjection(editor.state.doc.child(0), 'preview')?.textContent).toBe('second version');
  expect(revision.getCanonicalSession('b0')).toMatchObject({ pendingId: 'p0', revision: 2 });
  expect(revision.readBaseline().child(0).textContent).toBe('baseline');
});

it('A 刷新响应跨越 A→B→A 后不能安装到新的 A 会话', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['A'], []));
  let finish: (data: unknown) => void = () => {};
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refreshing = refreshMarkdownDocumentSession(editor, 'doc-a');
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  beginMarkdownDocumentSession(editor, 'doc-b', { setDirty: mocks.dirty, reportError: mocks.report });
  const latest = beginMarkdownDocumentSession(editor, 'doc-a', { setDirty: mocks.dirty, reportError: mocks.report });
  mocks.read.mockResolvedValueOnce({ success: true, data: snapshot(['new A'], []) });
  const opening = loadMarkdownDocumentSession(editor, latest);
  finish({ success: true, data: snapshot(['stale A']) });
  await Promise.all([refreshing, opening]);
  expect(editor.state.doc.textContent).toBe('new A');
  expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(0);
});

it('远端清空 Pending 后，普通编辑和保存不会使旧 Pending 复活', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['baseline']));
  mocks.read.mockResolvedValue({ success: true, data: snapshot(['baseline'], []) });
  await refreshMarkdownDocumentSession(editor, 'doc-a');
  editBlock(editor, 0, 'local');
  mocks.commit.mockImplementation(async (request: MarkdownRevisionCommit) => ({ success: true,
    data: { content: request.baseline, pendingRevisions: [], versionNumber: 2 } }));
  await saveMarkdownDocumentSession(editor, 'doc-a');
  expect(mocks.commit.mock.calls[0]?.[0].expectedPending).toEqual([]);
  expect(JSON.stringify(editor.getJSON())).not.toContain('revisionMark');
  expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(0);
});

it('全部接受与本地未保存正文一起提交，失败不清除视图或草稿', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['baseline', 'second']));
  editBlock(editor, 1, 'local draft');
  mocks.commit.mockResolvedValueOnce({ success: false, error: 'stale revision' });
  await expect(useRevisionStore(editor).acceptAllRevisionsInDocument()).rejects.toThrow('stale revision');
  const request: MarkdownRevisionCommit = mocks.commit.mock.calls[0]?.[0];
  expect(JSON.stringify(request.baseline)).toContain('local draft');
  expect(request.expectedPending).toEqual([{ id: 'p0', revision: 1 }]);
  expect(editor.state.doc.textContent).toContain('local draft');
  expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(1);
  expect(editor.isEditable).toBe(true);
});

it('保存期间新输入继续保留，且不会被错误标记为已保存', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['baseline'], []));
  editBlock(editor, 0, 'submitted');
  mocks.read.mockResolvedValue({ success: true, data: snapshot(['baseline'], []) });
  let finish: (data: unknown) => void = () => {};
  mocks.commit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saving = saveMarkdownDocumentSession(editor, 'doc-a');
  await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce());
  editBlock(editor, 0, 'typed during save');
  finish({ success: true, data: snapshot(['submitted'], [], 2) });
  await saving;
  expect(editor.state.doc.textContent).toBe('typed during save');
  expect(mocks.dirty).toHaveBeenLastCalledWith(true);
});

it('刷新保留独立本地编辑，同时接纳远端新增块', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['first', 'second'], []));
  editBlock(editor, 0, 'local');
  mocks.read.mockResolvedValueOnce({ success: true, data: snapshot(['first', 'second', 'added'], [], 2) });
  await refreshMarkdownDocumentSession(editor, 'doc-a');
  expect(editor.state.doc.textContent).toBe('localsecondadded');
  expect(mocks.dirty).toHaveBeenLastCalledWith(true);
});

it('同一段落的并发编辑保留本地并报告冲突', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['baseline'], []));
  editBlock(editor, 0, 'local');
  mocks.read.mockResolvedValueOnce({ success: true, data: snapshot(['remote'], [], 2) });
  await refreshMarkdownDocumentSession(editor, 'doc-a');
  expect(editor.state.doc.textContent).toBe('local');
  expect(mocks.report).toHaveBeenCalledOnce();
});

it('关闭时清除 Pending，旧会话不能再保存到其他文件', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['baseline']));
  await closeMarkdownDocumentSession(editor, 'doc-a');
  expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(0);
  await expect(saveMarkdownDocumentSession(editor, 'doc-a')).rejects.toThrow('会话不匹配');
  expect(mocks.commit).not.toHaveBeenCalled();
});

it('行内部分接受在提交前不改变可见文档，并携带剩余提议', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['old'], pending('new')));
  const original = editor.state.doc;
  let target: { from: number; to: number } | undefined;
  original.descendants((node, pos) => {
    if (node.marks.some(mark => mark.type.name === 'revisionMark' && mark.attrs.changeType === 'insert')) {
      target = { from: pos, to: pos + node.nodeSize };
    }
  });
  if (!target) throw new Error('Expected inserted revision text');
  mocks.commit.mockResolvedValueOnce({ success: false, error: 'conflict' });
  await expect(useRevisionStore(editor).acceptSingleRevision('b0', target.from, target.to)).rejects.toThrow('conflict');
  expect(editor.state.doc.eq(original)).toBe(true);
  const request: MarkdownRevisionCommit = mocks.commit.mock.calls[0]?.[0];
  expect(request.decision).toEqual({ mode: 'resolve', blockId: 'b0', remainingMarkdown: 'new' });
  expect(JSON.stringify(request.baseline)).toContain('new');
});

it('接受成功后安装完整快照，同时保留另一块本地草稿的提交结果', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['old', 'second']));
  editBlock(editor, 1, 'local draft');
  mocks.commit.mockResolvedValueOnce({ success: true, data: snapshot(['accepted', 'local draft'], [], 2) });
  await useRevisionStore(editor).acceptAllRevisionsInDocument();
  expect(editor.state.doc.textContent).toBe('acceptedlocal draft');
  expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(0);
  expect(mocks.dirty).toHaveBeenLastCalledWith(false);
});

it('表格替换投影的历史块不进入保存正文，Pending 清空后恢复完整原结构', async () => {
  const editor = createEditor();
  const original = snapshot(['original paragraph', 'second'], pending('| Header |\n| --- |\n| Value |'));
  await open(editor, original);
  const revision = useRevisionStore(editor);
  expect(revision.getCanonicalSession('b0')?.projection).toBe('ready');
  expect(editor.state.doc.childCount).toBe(3);
  expect(editor.state.doc.child(1).child(0).type.name).toBe('table');
  expect(revision.readBaseline().toJSON()).toEqual(editor.schema.nodeFromJSON(original.content).toJSON());
  editBlock(editor, 2, 'local draft');
  mocks.read.mockResolvedValueOnce({ success: true, data: original });
  mocks.commit.mockImplementationOnce(async (request: MarkdownRevisionCommit) => ({ success: true,
    data: { content: request.baseline, pendingRevisions: original.pendingRevisions, versionNumber: 2 } }));
  await saveMarkdownDocumentSession(editor, 'doc-a');
  expect(JSON.stringify(mocks.commit.mock.calls[0]?.[0].baseline)).not.toContain('table');
  mocks.read.mockResolvedValueOnce({ success: true, data: snapshot(['original paragraph', 'local draft'], [], 2) });
  await refreshMarkdownDocumentSession(editor, 'doc-a');
  expect(editor.state.doc.childCount).toBe(2);
  expect(editor.state.doc.textContent).toBe('original paragraphlocal draft');
  expect(revision.canonicalPendingBlockCount.value).toBe(0);
});

it('初次读取失败后解除会话，不能把上一份可见正文保存到加载失败的文件', async () => {
  const editor = createEditor();
  await open(editor, snapshot(['original'], []));
  const session = beginMarkdownDocumentSession(editor, 'failed-doc', { setDirty: mocks.dirty, reportError: mocks.report });
  mocks.read.mockResolvedValueOnce({ success: false, error: 'read failed' });
  await expect(loadMarkdownDocumentSession(editor, session)).rejects.toThrow('read failed');
  await expect(saveMarkdownDocumentSession(editor, 'failed-doc')).rejects.toThrow('会话不匹配');
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(editor.state.doc.textContent).toBe('original');
});

it('刷新和提交复用首开的虚拟化安装策略，大文档不会在新快照到达时全文水合', async () => {
  const editor = createEditor();
  editor.registerPlugin(createRenderVirtualizationPlugin());
  const initial = snapshot(Array.from({ length: 1600 }, (_, index) => `block ${index}`), []);
  const session = beginMarkdownDocumentSession(editor, 'large-doc', {
    setDirty: mocks.dirty, reportError: mocks.report,
    loadBaseline: document => { loadDocumentJsonAtomically(editor, document.toJSON(), {
      prepareState: state => prepareInitialRenderVirtualizationState(state, { enabled: true, initialHydratedBlockCount: 8 }),
    }); },
  });
  mocks.read.mockResolvedValueOnce({ success: true, data: initial });
  await loadMarkdownDocumentSession(editor, session);
  mocks.read.mockResolvedValueOnce({ success: true, data: { ...initial, pendingRevisions: pending('changed') } });
  await refreshMarkdownDocumentSession(editor, 'large-doc');
  const virtual = getRenderVirtualizationState(editor.state);
  expect(virtual?.enabled).toBe(true);
  expect(virtual?.hydratedSet.size).toBe(8);
});

function styledSnapshot(markdown: string): MarkdownRevisionSnapshot {
  const data = snapshot(['重点和原句。'], pending(markdown));
  const content = doc(['重点和原句。']);
  const paragraph = content.content?.[0]?.content?.[0];
  if (!paragraph) throw new Error('Missing fixture paragraph');
  paragraph.content = [
    { type: 'text', text: '重点', marks: [
      { type: 'textColor', attrs: { color: 'red_text' } },
      { type: 'textHighlight', attrs: { color: 'bright_yellow' } },
    ] },
    { type: 'text', text: '和原句。' },
  ];
  return { ...data, content };
}

it('真实 Pending 投影和刷新保留颜色高亮，格式修订不把颜色当作 AI 的删改意图', async () => {
  const editor = createEditor();
  const original = styledSnapshot('**重点**和改句。');
  await open(editor, original);
  const assertPresentation = () => {
    const preview = stripRevisionProjection(editor.state.doc.child(0), 'preview');
    const first = preview?.child(0).child(0);
    expect(first?.text).toBe('重点');
    expect(first?.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['bold', 'textColor', 'textHighlight']));
    expect(first?.marks.find(mark => mark.type.name === 'textColor')?.attrs.color).toBe('red_text');
    expect(first?.marks.find(mark => mark.type.name === 'textHighlight')?.attrs.color).toBe('bright_yellow');
    expect(useRevisionStore(editor).readBaseline().toJSON()).toEqual(editor.schema.nodeFromJSON(original.content).toJSON());
  };
  assertPresentation();
  mocks.read.mockResolvedValueOnce({ success: true, data: original });
  await refreshMarkdownDocumentSession(editor, 'doc-a');
  assertPresentation();
});

it.each(['accept', 'reject'] as const)('行内部分 %s 提交与重新投影保留未改文字的颜色高亮', async action => {
  const editor = createEditor();
  await open(editor, styledSnapshot('重点和原句。第一处新增。第二处新增。'));
  let target: { from: number; to: number } | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.isText && node.marks.some(mark => mark.type.name === 'revisionMark' && mark.attrs.changeType === 'insert')) {
      target = { from: position, to: position + '第一处新增。'.length };
    }
  });
  if (!target) throw new Error('Missing projected insertion');
  mocks.commit.mockImplementationOnce(async (request: MarkdownRevisionCommit) => ({ success: true, data: {
    content: request.baseline, versionNumber: 2,
    pendingRevisions: request.decision?.mode === 'resolve' && request.decision.remainingMarkdown !== null
      ? pending(request.decision.remainingMarkdown, 1, 2) : [],
  } }));
  const revision = useRevisionStore(editor);
  await (action === 'accept' ? revision.acceptSingleRevision('b0', target.from, target.to)
    : revision.rejectSingleRevision('b0', target.from, target.to));
  const baseline = revision.readBaseline();
  expect(baseline.child(0).child(0).child(0).marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['textColor', 'textHighlight']));
  expect(baseline.textContent).toBe(action === 'accept' ? '重点和原句。第一处新增。' : '重点和原句。');
  expect(stripRevisionProjection(editor.state.doc.child(0), 'preview')?.child(0).child(0).marks.map(mark => mark.type.name))
    .toEqual(expect.arrayContaining(['textColor', 'textHighlight']));
});

it('表格插行与改值后的 Pending 预览保留原单元格标注，历史投影不影响保存基线', async () => {
  const { importMarkdownToDocJson } = await import('src/domains/markdown/features/normalization');
  const imported = await importMarkdownToDocJson('| 名称 | 数值 |\n| --- | --- |\n| 重点 | 10 |\n| 次要 | 20 |');
  const editor = createEditor();
  const parsed = editor.schema.nodeFromJSON(imported.docJson);
  const oldRoot = parsed.child(0);
  const root = oldRoot.type.create({ ...oldRoot.attrs, id: 'b0' }, oldRoot.content);
  const initial = editor.schema.nodes.doc.create(null, root);
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, initial.content);
  tr.doc.descendants((node, position) => {
    if (node.text === '重点') {
      tr.addMark(position, position + node.nodeSize, editor.schema.marks.textColor.create({ color: 'red_text' }));
      tr.addMark(position, position + node.nodeSize, editor.schema.marks.textHighlight.create({ color: 'bright_yellow' }));
    }
  });
  const baseline = tr.doc;
  await open(editor, { content: baseline.toJSON(), versionNumber: 1,
    pendingRevisions: pending('| 名称 | 数值 |\n| --- | --- |\n| 新增 | 5 |\n| 重点 | 12 |\n| 次要 | 20 |') });
  const revision = useRevisionStore(editor);
  let styled = '';
  editor.state.doc.forEach(node => {
    if (node.attrs.id !== 'b0') return;
    node.descendants(child => { if (child.marks.some(mark => mark.type.name === 'textColor')) styled += child.text ?? ''; });
  });
  expect(styled).toBe('重点');
  expect(revision.readBaseline().eq(baseline)).toBe(true);
});

it('跨 Revision 节点的 emoji 仍按完整字素判定，不保留改写后的半个高亮', async () => {
  const editor = createEditor();
  const content = doc(['👩‍💻']);
  const text = content.content?.[0]?.content?.[0]?.content?.[0];
  if (!text) throw new Error('Missing fixture text');
  text.marks = [{ type: 'textHighlight', attrs: { color: 'bright_yellow' } }];
  await open(editor, { content, versionNumber: 1, pendingRevisions: pending('👩‍🔬') });
  const preview = stripRevisionProjection(editor.state.doc.child(0), 'preview');
  expect(preview?.textContent).toBe('👩‍🔬');
  preview?.descendants(node => expect(node.marks.some(mark => mark.type.name === 'textHighlight')).toBe(false));
});
