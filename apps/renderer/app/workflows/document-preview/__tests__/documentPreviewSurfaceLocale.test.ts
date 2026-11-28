// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceMarkdownPreviewSchema, type DocumentPreviewResult } from '@app/schemas';
import { createDocumentPreviewSurface, documentPreviewMessage } from '@linnya/document-preview';

beforeEach(() => {
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const surface = async (preview: DocumentPreviewResult, locale?: string, onOpen?: () => void) =>
  createDocumentPreviewSurface({
    preview,
    document,
    widthPx: 320,
    theme: 'light',
    signal: new AbortController().signal,
    ...(locale ? { locale } : {}),
    ...(onOpen ? { onOpen } : {}),
  });
const unavailable = (status: DocumentPreviewResult['status']): DocumentPreviewResult => ({
  documentId: 'doc', title: null, nodeType: null, status,
});

describe('预览外壳文字按界面语言显示', () => {
  it('没有标题时的标题行与状态说明：英文、中文、缺省（中文）', async () => {
    const english = await surface(unavailable('deleted'), 'en-US');
    expect(english.element.querySelector('.document-preview-name')?.textContent).toBe('Document unavailable');
    expect(english.element.querySelector('.document-preview-status')?.textContent).toBe('This document has been deleted');
    const chinese = await surface(unavailable('deleted'), 'zh-CN');
    expect(chinese.element.querySelector('.document-preview-name')?.textContent).toBe('文档当前不可访问');
    expect(chinese.element.querySelector('.document-preview-status')?.textContent).toBe('文档已删除');
    const fallback = await surface(unavailable('outside_project'));
    expect(fallback.element.querySelector('.document-preview-status')?.textContent).toBe('目标在其他项目，当前不可访问');
  });
  it('四种不可预览状态都有英文说明，且不含中文', () => {
    for (const status of ['deleted', 'outside_project', 'plugin_unavailable', 'preview_unavailable'] as const) {
      const text = documentPreviewMessage(status, 'en-US');
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[一-龥]/);
      expect(documentPreviewMessage(status)).toMatch(/[一-龥]/);
    }
  });
  it('标题按钮的无障碍名称按语言生成', async () => {
    const preview: DocumentPreviewResult = { documentId: 'doc', title: 'Plan', nodeType: 'document', status: 'preview_unavailable' };
    const english = await surface(preview, 'en-US', () => {});
    expect(english.element.querySelector('button.document-preview-title')?.getAttribute('aria-label')).toBe('Open document: Plan');
    const chinese = await surface(preview, undefined, () => {});
    expect(chinese.element.querySelector('button.document-preview-title')?.getAttribute('aria-label')).toBe('打开文档：Plan');
  });
  it('正文里的失效引用与参考文献标题同样随语言显示', async () => {
    const detail = WorkspaceMarkdownPreviewSchema.parse({
      format: 'workspace-markdown',
      document: { type: 'doc', content: [
        { type: 'rootBlock', attrs: { id: 'a' }, content: [{ type: 'baseBlock', attrs: { id: 'a-body' }, content: [
          { type: 'text', text: 'see ' },
          { type: 'documentReference', attrs: { documentId: 'gone', referenceId: 'r1' } },
          { type: 'documentReference', attrs: { documentId: 'foreign', referenceId: 'r2' } },
        ] }] },
        { type: 'rootBlock', attrs: { id: 'b' }, content: [{ type: 'bibliographyBlock', attrs: { id: 'b-body' } }] },
      ] },
      images: {},
      references: {
        gone: { documentId: 'gone', status: 'deleted', title: null, nodeType: null },
        foreign: { documentId: 'foreign', status: 'outside_project', title: null, nodeType: null },
      },
    });
    const preview: DocumentPreviewResult = {
      documentId: 'doc', title: 'Doc', nodeType: 'document', status: 'ready',
      content: { revisionKey: '1', summary: '', detail },
    };
    const english = await surface(preview, 'en-US');
    document.body.append(english.element);
    const labels = [...english.element.querySelectorAll('.markdown-document-reference-label')].map(e => e.textContent);
    expect(labels).toEqual(['Deleted document', 'Document in another project']);
    expect(english.element.querySelector('.workspace-preview-bibliography h3')?.textContent).toBe('References');
    english.dispose();
    const chinese = await surface(preview);
    document.body.append(chinese.element);
    expect([...chinese.element.querySelectorAll('.markdown-document-reference-label')].map(e => e.textContent)).toEqual(['文档已删除', '其他项目的文档']);
    chinese.dispose();
  });
});
