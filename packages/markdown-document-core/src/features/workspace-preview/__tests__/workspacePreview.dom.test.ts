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
  it('只读预览输出表格样式，默认样式不写属性', async () => {
    const cell = { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'tableCellContentBlock', content: [text('格')] }] }] };
    const content = WorkspaceMarkdownPreviewSchema.parse({
      format: 'workspace-markdown',
      document: { type: 'doc', content: [root('styled', 'table', { tableStyle: 'accent-header' }, [cell]), root('plain', 'table', {}, [cell])] },
      assets: {}, references: {},
    });
    const preview = await createWorkspaceMarkdownPreview({ content, document, widthPx: 320, theme: 'light', signal: new AbortController().signal });
    const tables = preview.element.querySelectorAll('table.table-block');
    expect(tables[0]?.getAttribute('data-table-style')).toBe('accent-header');
    expect(tables[1]?.hasAttribute('data-table-style')).toBe(false);
  });

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
    // 与编辑器、PDF 共用表格呈现：同一 class 与短格判定。
    expect(preview.element.querySelector('.workspace-preview-table > table.table-block')).not.toBeNull();
    expect(preview.element.querySelector('th')?.classList.contains('table-cell--compact')).toBe(true);
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

  it('全文只等一次字体，首屏只为已排出的块等待，长文不会逐块触发整页布局', async () => {
    // Chromium 每读一次已就绪的 fonts.ready 都同步重排整份预览；逐块读取曾让 631 块的全文生成卡住一秒以上。
    let reads = 0;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { get ready() { reads += 1; return Promise.resolve(); } } });
    try {
      const cell = { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'tableCellContentBlock', content: [text('格')] }] }] };
      const blocks = Array.from({ length: 120 }, (_, index) => root(`p-${index}`, 'baseBlock', {}, [text(`第 ${index} 段`)]));
      const content = WorkspaceMarkdownPreviewSchema.parse({ format: 'workspace-markdown',
        document: { type: 'doc', content: [...blocks, root('table', 'table', {}, [cell])] }, assets: {}, references: {} });
      // jsdom 不做布局：让表格比可用宽度宽，定级结果才可观察。
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
      const full = await createWorkspaceMarkdownPreview({ content, document, widthPx: 320, theme: 'light', signal: new AbortController().signal });
      expect(full.element.querySelectorAll('.workspace-preview-block')).toHaveLength(121);
      expect(reads).toBe(1);
      // 表格定级在字体就绪之后统一完成，全文里的表格不会被漏掉。
      expect(full.element.querySelector('table.table-block')?.getAttribute('data-table-fit')).toBe('scroll');
      full.dispose();

      reads = 0;
      let height = 0;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        height += 60;
        return { width: 320, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: 320, toJSON: () => ({}) };
      });
      const first = await createWorkspaceMarkdownPreview({ content, document, widthPx: 320, maxHeight: 200, theme: 'light', signal: new AbortController().signal });
      const rendered = first.element.querySelectorAll('.workspace-preview-block').length;
      expect(rendered).toBe(4);
      expect(reads).toBe(rendered + 1);
      first.dispose();
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
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
