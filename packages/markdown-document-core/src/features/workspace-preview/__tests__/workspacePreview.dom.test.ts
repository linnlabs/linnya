// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceMarkdownPreviewSchema, JsonValueSchema } from '@app/schemas';
import { createWorkspaceMarkdownPreview } from '../index';
import { workspaceMarkdownSchemaLite } from '../../workspace-schema';
import { renderWorkspaceTextBlock } from '../functions/workspaceBlockPresentation';
import { workspaceListNumbers } from '../functions/workspaceListNumbers';

const pixels = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmfkAAAAASUVORK5CYII=';
const root = (id: string, type: string, attrs: Record<string, unknown> = {}, content: unknown[] = []) => ({
  type: 'rootBlock', attrs: { id }, content: [{ type, attrs: { id: `${id}-body`, ...attrs }, ...(content.length ? { content } : {}) }],
});
const text = (value: string) => ({ type: 'text', text: value });
const fixture = () => WorkspaceMarkdownPreviewSchema.parse({
  format: 'workspace-markdown',
  document: { type: 'doc', content: [
    root('heading', 'headingBlock', { level: 1 }, [text('同一份可读文档')]),
    root('text', 'baseBlock', {}, [text('正文 '), { type: 'inlineLatex', attrs: { latexSource: 'x^2' } },
      { type: 'documentReference', attrs: { documentId: 'target', referenceId: 'reference-1' } },
      { type: 'citationNode', attrs: { citationId: 'cite-1', sourceId: 'source-1', sourceType: 'web', title: '真实来源', authors: ['作者甲'], date: '2026', url: 'https://example.com' } },
    ]),
    root('image', 'imageBlock', { src: 'media://load/not-used', assetId: 'asset-1', caption: '图注保留' }),
    root('legacy-image', 'imageBlock', { src: 'media://load/old-locator', caption: '历史图片' }),
    root('list-a', 'listItemBlock', { listType: 'ordered', start: 5 }, [text('第五项')]),
    root('list-b', 'listItemBlock', { listType: 'ordered' }, [text('第六项')]),
    root('table', 'table', {}, [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { style: 'text-align: right;', colwidth: [180] }, content: [{ type: 'tableCellContentBlock', content: [text('表头')] }] }] }]),
    root('math', 'latexBlock', { latexSource: '\\frac{a}{b}' }),
    root('chart', 'chartBlock', { spec: { chartType: 'bar', title: '营收图', categories: ['甲', '乙'], series: [{ name: '收入', values: [1, 2] }] } }),
    root('bibliography', 'bibliographyBlock'),
  ] },
  assets: { 'asset-1': pixels, 'legacy-image-body': pixels },
  references: { target: { documentId: 'target', status: 'available', title: '当前标题', nodeType: 'document' } },
});

beforeEach(() => {
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('正式 Workspace 用户预览', () => {
  it('真实正文、资产、图表、公式、编号与参考文献在同一个静态表面完整呈现', async () => {
    const controller = new AbortController();
    const preview = await createWorkspaceMarkdownPreview({ content: fixture(), document, widthPx: 320, theme: 'dark', signal: controller.signal });
    document.body.append(preview.element);
    expect(preview.element.textContent).toContain('当前标题');
    expect(preview.element.textContent).toContain('真实来源');
    expect(preview.element.textContent).toContain('[1]');
    expect(preview.element.querySelectorAll('.katex')).toHaveLength(2);
    const pictures = preview.element.querySelectorAll('.image-block img');
    expect(pictures).toHaveLength(2);
    expect(Array.from(pictures, image => image.getAttribute('src'))).toEqual([pixels, pixels]);
    expect(preview.element.querySelectorAll('[data-ordered-index]')).toHaveLength(2);
    expect(preview.element.querySelector('[data-ordered-index="6"]')?.textContent).toBe('第六项');
    expect(preview.element.querySelector('th')?.textContent).toBe('表头');
    expect(preview.element.querySelector('th')?.style.textAlign).toBe('right');
    expect(preview.element.querySelector('th')?.style.width).toBe('180px');
    const chart = preview.element.querySelector('.workspace-preview-chart img');
    expect(chart?.getAttribute('src')).toContain('data:image/svg+xml');
    const svg = decodeURIComponent(chart?.getAttribute('src')?.split(',').slice(1).join(',') ?? '');
    expect(svg).toContain('营收图');
    expect(svg).toContain('甲');
    expect(svg).toContain('乙');
    expect(preview.element.querySelector('[contenteditable="true"]')).toBeNull();
    expect(preview.element.textContent).not.toContain('linnya-chart');
    controller.abort();
    expect(document.body.children).toHaveLength(0);
    preview.dispose();
  });

  it('首屏已覆盖后不准备屏下图像，详情则明确报告缺失资源', async () => {
    const content = WorkspaceMarkdownPreviewSchema.parse({ format: 'workspace-markdown',
      document: { type: 'doc', content: [root('first', 'baseBlock', {}, [text('首屏')]), root('missing', 'imageBlock', { assetId: 'absent', src: 'media://missing' })] },
      assets: {}, references: {},
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return { width: 320, height: 400, x: 0, y: 0, top: 0, left: 0, bottom: 400, right: 320, toJSON: () => ({}) };
    });
    const preview = await createWorkspaceMarkdownPreview({ content, document, widthPx: 320, maxHeight: 200, theme: 'light', signal: new AbortController().signal });
    expect(preview.element.textContent).toBe('首屏');
    expect(preview.element.dataset.previewClipped).toBe('true');
    preview.dispose();
    await expect(createWorkspaceMarkdownPreview({ content, document, widthPx: 320, theme: 'light', signal: new AbortController().signal })).rejects.toThrow('preview_image_resource_missing:absent');
    expect(document.body.children).toHaveLength(0);
  });

  it('Pending 删除最后一个块时展示空白，持久化 schema 仍拒绝空正文', async () => {
    const content = WorkspaceMarkdownPreviewSchema.parse({ format: 'workspace-markdown', document: { type: 'doc', content: [] }, assets: {}, references: {} });
    const preview = await createWorkspaceMarkdownPreview({ content, document, widthPx: 320, theme: 'light', signal: new AbortController().signal });
    expect(preview.element.childElementCount).toBe(0);
    expect(() => workspaceMarkdownSchemaLite.nodeFromJSON(content.document).check()).toThrow();
    preview.dispose();
    expect(document.body.children).toHaveLength(0);
  });

  it('取消在途解码释放测量 DOM，迟到的图片完成不恢复旧内容', async () => {
    let finish: (() => void) | undefined;
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = createWorkspaceMarkdownPreview({ content: fixture(), document, widthPx: 320, theme: 'light', signal: controller.signal });
    await vi.waitFor(() => expect(document.querySelector('img')).not.toBeNull());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    finish?.();
    await Promise.resolve();
    expect(document.body.children).toHaveLength(0);
  });

  it('共用编号与块呈现支持嵌套重起，数据结构仍由唯一schema拒绝未知节点', async () => {
    const documentJson = { type: 'doc', content: [
      root('a', 'listItemBlock', { listType: 'ordered', start: 3 }, [text('A')]),
      root('b', 'listItemBlock', { listType: 'ordered', level: 1 }, [text('B')]),
      root('c', 'listItemBlock', { listType: 'ordered' }, [text('C')]),
    ] };
    const node = workspaceMarkdownSchemaLite.nodeFromJSON(documentJson);
    expect(workspaceListNumbers(node).map(item => item.value)).toEqual([3, 1, 4]);
    const block = node.firstChild?.firstChild;
    if (!block) throw new Error('fixture missing');
    const rendered = renderWorkspaceTextBlock(block, document);
    expect(rendered.contentDOM?.dataset.listType).toBe('ordered');
    const content = fixture();
    content.document = JsonValueSchema.parse({ type: 'doc', content: [{ type: 'unknownNode' }] });
    await expect(createWorkspaceMarkdownPreview({ content, document, widthPx: 320, theme: 'light', signal: new AbortController().signal })).rejects.toThrow('unknownNode');
  });
});
