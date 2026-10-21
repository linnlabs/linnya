// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { ConversationCitation } from '@app/schemas';
import { CitationNode } from '../../../../../editor/features/citation/nodes/CitationNode';
import { registerWorkspaceDocumentExportPort } from '../../../../../../shared/ports/workspaceDocumentExportPort';
import {
  copyRenderedAnswersToClipboard,
  exportRenderedAnswersAsDocument,
  extractRenderedAnswerHtml,
} from './richClipboardActions';

function appendAnswer(container: HTMLElement, messageId: string, text: string): void {
  const message = document.createElement('div');
  message.className = 'message-type-final_answer';
  message.dataset.conversationMessageId = messageId;
  const renderer = document.createElement('div');
  renderer.className = 'markstream-message-renderer';
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  renderer.appendChild(paragraph);
  message.appendChild(renderer);
  container.appendChild(message);
}

describe('extractRenderedAnswerHtml', () => {
  it('extracts only the terminal final answer selected by the action row', () => {
    const container = document.createElement('div');
    appendAnswer(container, 'answer-old', 'old answer');
    appendAnswer(container, 'answer-current', 'current answer');

    const html = extractRenderedAnswerHtml({
      containerEl: container,
      copyScope: 'turn-answer',
      answerMessageIds: ['answer-current'],
    });

    expect(html).toContain('current answer');
    expect(html).not.toContain('old answer');
  });
});


const editors: Editor[] = [];

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  vi.unstubAllGlobals();
});

const citationSnapshots: ConversationCitation[] = [
  {
    ref: 'Abc234', index: 1, sourceType: 'web',
    url: 'https://example.com/article', docTitle: '文章标题', snippet: '取得时的来源原文',
    authors: ['Alice', 'Bob', 'Carol'], containerTitle: 'Journal of Examples',
    publishedAt: '2026-01-02',
  },
  {
    ref: 'Def567', index: 2, sourceType: 'knowledge_base',
    docId: 'document-1', kbId: 'knowledge-1', blockId: 'block-1',
    docTitle: '知识库原件', snippet: '块级原文',
  },
];

function createCitationAnswer(): HTMLElement {
  const container = document.createElement('div');
  appendAnswer(container, 'answer-current', '正文');
  const paragraph = container.querySelector('p');
  if (!paragraph) throw new Error('answer paragraph missing');
  for (const citation of citationSnapshots) {
    const node = document.createElement('span');
    node.dataset.citationRef = citation.ref;
    node.dataset.turnId = 'turn-1';
    node.textContent = `[${citation.index}]`;
    paragraph.appendChild(node);
  }
  return container;
}

function createEditor(): Editor {
  const editor = new Editor({ extensions: [StarterKit, CitationNode] });
  editors.push(editor);
  return editor;
}

function assertPreservedSnapshots(editor: Editor): void {
  const snapshots: Record<string, unknown>[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'citationNode') snapshots.push(node.attrs);
  });
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0]).toMatchObject({
    ref: 'Abc234', sourceType: 'web', sourceId: 'https://example.com/article',
    url: 'https://example.com/article', title: '文章标题', snippet: '取得时的来源原文',
    authors: ['Alice', 'Bob', 'Carol'], containerTitle: 'Journal of Examples', date: '2026-01-02',
  });
  expect(snapshots[1]).toMatchObject({
    ref: 'Def567', sourceType: 'knowledge_base', sourceId: 'document-1',
    kbId: 'knowledge-1', blockId: 'block-1', title: '知识库原件', snippet: '块级原文',
  });
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('clipboard blob did not contain text'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('Conversation rich copy and save-as citation metadata', () => {
  const findCitationByRef = (_turnId: string, ref: string) => (
    citationSnapshots.find(citation => citation.ref === ref) ?? null
  );

  it('富复制的实际 HTML 粘贴后保留全部作者、刊名和知识库 ID，Editor JSON 重载后仍完整', async () => {
    const clipboardItems: Array<Record<string, Blob>> = [];
    class ClipboardItemStub {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemStub);
    vi.stubGlobal('ClipboardEvent', Event);
    vi.stubGlobal('navigator', {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      clipboard: {
        write: async (items: ClipboardItemStub[]) => {
          clipboardItems.push(...items.map(item => item.items));
        },
      },
    });

    const result = await copyRenderedAnswersToClipboard({
      containerEl: createCitationAnswer(), plainText: '正文 [@Abc234] [@Def567]',
      copyScope: 'turn-answer', findCitationByRef, generateCitationId: () => crypto.randomUUID(),
      conversationMessage: key => key,
    });
    expect(result).toMatchObject({ success: true, wroteHtml: true, hydrationStats: { hydrated: 2 } });
    expect(clipboardItems).toHaveLength(1);
    const html = await readBlobText(clipboardItems[0]['text/html']);
    const target = createEditor();
    expect(target.view.pasteHTML(html)).toBe(true);
    assertPreservedSnapshots(target);
    const reloaded = createEditor();
    reloaded.commands.setContent(structuredClone(target.getJSON()));
    assertPreservedSnapshots(reloaded);
  });

  it('另存操作把同一完整 HTML 交给 Workspace port，按真实 setContent 保存路径解析后不丢元数据', async () => {
    const saved = createEditor();
    const names: string[] = [];
    registerWorkspaceDocumentExportPort({
      async saveHtmlAsMarkdownDocument(params) {
        names.push(params.name);
        // app-level 导出用例使用同一个 Editor setContent 入口；此处隔离存储与导航副作用。
        saved.commands.setContent(params.html);
        return { success: true, documentId: 'saved-document' };
      },
    });
    const result = await exportRenderedAnswersAsDocument({
      containerEl: createCitationAnswer(), plainText: '# 独立文档\n正文 [@Abc234] [@Def567]',
      copyScope: 'turn-answer', findCitationByRef, generateCitationId: () => crypto.randomUUID(),
      conversationMessage: key => key,
    });
    expect(result).toMatchObject({
      success: true, documentId: 'saved-document', extractedHtml: true,
      hydrationStats: { total: 2, hydrated: 2, missing: [] },
    });
    expect(names).toEqual(['独立文档']);
    assertPreservedSnapshots(saved);
    const reloaded = createEditor();
    reloaded.commands.setContent(structuredClone(saved.getJSON()));
    assertPreservedSnapshots(reloaded);
  });
});
