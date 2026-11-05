// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import type { MarkdownRevisionSnapshot } from '@app/schemas';

vi.hoisted(() => Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} }));
const gateway = vi.hoisted(() => ({ read: vi.fn(), commit: vi.fn() }));
vi.mock('@/shared/ipc/workspaceGateway', () => ({ workspaceGateway: { 'read-document': gateway.read, 'commit-markdown-revision': gateway.commit } }));
vi.mock('@/shared/services/markdownService', () => ({ parseMarkdown: vi.fn(), parseMarkdownToBlocksByStreaming: vi.fn() }));
vi.mock('./markdownRuntime/parser', async () => {
  const { parseMarkdownToBlocksInNode } = await import('src/domains/markdown/features/normalization');
  return { parseMarkdownToBlockEvents: parseMarkdownToBlocksInNode };
});

import { getAllExtensions } from '../core/extensionRegistry';
import { useEditorDocumentSettingsStore } from '../features/DocumentSettings';
import { useRevisionStore } from '../features/Revision/runtime';
import { refreshMarkdownDocumentSession } from '../features/document-session';
import { loadDocumentFromDatabase } from './editorService';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.clearAllMocks(); });
const documentOf = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'rootBlock', attrs: { id: 'root-count' },
  content: [{ type: 'baseBlock', attrs: { id: 'content-count', blockType: 'base' }, content: [{ type: 'text', text }] }] }] });
function snapshot(text: string, versionNumber: number, pending = false): MarkdownRevisionSnapshot {
  return { content: documentOf(text), versionNumber, pendingRevisions: pending ? [{
    id: 'pending-count', revision: 1, blockId: 'root-count', newMarkdown: '现在已经修订完成', operation: 'update',
    source: 'ai', metaJson: null, createdAt: 1, updatedAt: 1,
  }] : [] };
}

it('不重新加载文档，接受修订及远端快照安装后字数自动同步', async () => {
  setActivePinia(createPinia());
  const editor = new Editor({ extensions: getAllExtensions({ layoutManagerInstance: ref(null), findReplaceStore: null }), content: documentOf('初始') });
  editors.push(editor);
  const fileStore = { currentFilePath: '', setDirty: vi.fn(), setFilePath: (id: string) => { fileStore.currentFilePath = id; } };
  gateway.read.mockResolvedValueOnce({ success: true, data: snapshot('原文', 1) });
  await loadDocumentFromDatabase({ editor, stores: { fileStore, notificationStore: { show: vi.fn() }, annotationStore: ref(null) }, documentId: 'count-document', documentName: 'count.md' });
  const settings = useEditorDocumentSettingsStore();
  await vi.waitFor(() => expect(settings.characterCount).toBe(2));

  gateway.read.mockResolvedValueOnce({ success: true, data: snapshot('原文', 1, true) });
  await refreshMarkdownDocumentSession(editor, 'count-document');
  gateway.commit.mockResolvedValueOnce({ success: true, data: snapshot('现在已经修订完成', 2) });
  await useRevisionStore(editor).acceptAllRevisionsInDocument();
  await vi.waitFor(() => expect(settings.characterCount).toBe(8));
  expect(editor.state.doc.textContent).toBe('现在已经修订完成');

  gateway.read.mockResolvedValueOnce({ success: true, data: snapshot('再次更新正文', 3) });
  await refreshMarkdownDocumentSession(editor, 'count-document');
  await vi.waitFor(() => expect(settings.characterCount).toBe(6));
  expect(fileStore.currentFilePath).toBe('count-document');
});
