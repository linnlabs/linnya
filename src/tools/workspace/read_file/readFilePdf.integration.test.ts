import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { formatHostFileLocator, WorkspaceReadFileResultSchema } from '@app/schemas';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodePhysicalFileReader } from 'src/app-hosts/linnya/adapters/file-read/createNodePhysicalFileReader';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { createTextPdf, type TextPdfPage } from 'src/features/parsers/pdfParser/testkit/createTextPdf';
import { ReadFileTool } from './ReadFileTool';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function writePdf(pages: readonly TextPdfPage[], name = 'report.pdf'): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-read-file-pdf-'));
  temporaryRoots.push(root);
  const filePath = path.join(root, name);
  await fsp.writeFile(filePath, createTextPdf(pages));
  return formatHostFileLocator(filePath);
}

function createContext(options: { readonly imageAdmitted?: boolean } = {}) {
  const ingestImageBytes = vi.fn(async ({ bytes }: { bytes: Uint8Array }) => ({
    assetId: 'asset-pdf-page',
    uri: 'asset://assets/asset-pdf-page',
    mediaType: 'image/jpeg' as const,
    byteLength: bytes.byteLength,
    width: 1087,
    height: 1536,
    sha256: 'b'.repeat(64),
    storagePath: 'managed/asset-pdf-page.jpg',
    createdAt: 1,
  }));
  const issueClaims = vi.fn((input: { selections: readonly { selectionId: string }[] }) =>
    input.selections.map(selection => ({ selectionId: selection.selectionId, uri: 'asset-claim://claim-1' })));
  const context = createToolContextFixture({
    conversationId: 'conv-pdf-read',
    turnId: 'turn-pdf-read',
    patch: {
      runId: RunIdSchema.parse('agent-run-pdf'),
      parentToolCallId: ToolCallIdSchema.parse('tool-call-pdf'),
      physicalFileReader: createNodePhysicalFileReader(),
      managedImageIngress: {
        ingestImageBytes,
        ingestLocalImage: vi.fn(() => Promise.reject(new Error('PDF 页面不经本地路径入库。'))),
      },
      toolResultAssetClaims: { issueClaims, consumeClaims: vi.fn(() => []), releaseClaims: vi.fn() },
      ...(options.imageAdmitted === false ? { modelInputAdmission: { admitted: false } } : {}),
    },
  });
  return { context, ingestImageBytes, issueClaims };
}

async function read(args: Record<string, unknown>, options: { readonly imageAdmitted?: boolean } = {}) {
  const { context, ...spies } = createContext(options);
  const result = WorkspaceReadFileResultSchema.parse(JSON.parse(await new ReadFileTool().run(args, context)));
  return { result, ...spies };
}

const longPages = Array.from({ length: 30 }, (_, index) => [`Section ${index + 1}`, `Body text for page ${index + 1}.`]);

describe('read_file 读取 PDF', () => {
  it('默认从第 1 页按页返回文字层，并给出下一段页码', async () => {
    const locator = await writePdf(longPages);
    const { result, ingestImageBytes } = await read({ locator });
    expect(result.data).toMatchObject({
      source_kind: 'host_file',
      content_type: 'application/pdf',
      page_count: 30,
      mode: 'pages',
      pages: { from: 1, to: 20 },
      has_more: true,
      next_pages: '21-30',
      pages_without_text: [],
    });
    expect(result.observation).toContain('[Page 1]\nSection 1\nBody text for page 1.');
    expect(result.observation).toContain(`read_file(${JSON.stringify({ locator, pages: '21-30' })})`);
    expect(ingestImageBytes).not.toHaveBeenCalled();
  });

  it('pages 指定页，列出没有文字层的页并提示看图', async () => {
    const locator = await writePdf([['Cover'], null, ['Appendix']]);
    const { result } = await read({ locator, pages: '2-3' });
    expect(result.data).toMatchObject({ pages: { from: 2, to: 3 }, has_more: false, pages_without_text: [2] });
    expect(result.observation).toContain('[Page 2: no text layer]');
    expect(result.observation).toContain('"view":"page_image","pages":"2"');
    expect(result.observation).not.toContain('Cover');
  });

  it('页文字超出单次输出预算时在页边界停下，续读请求剩余页', async () => {
    const dense = Array.from({ length: 5 }, (_, page) =>
      Array.from({ length: 40 }, (_, line) => `P${page + 1}L${line + 1} `.padEnd(90, 'x')));
    const locator = await writePdf(dense);
    const { result } = await read({ locator, pages: '1-5' });
    expect(result.data).toMatchObject({ pages: { from: 1, to: 4 }, has_more: true, next_pages: '5' });
    expect(result.observation).toContain('Stopped after page 4');
    expect(result.observation.length).toBeLessThan(18_000);
  });

  it('find 返回命中页和上下文，查找范围超出时给出续查调用', async () => {
    const locator = await writePdf(longPages);
    const { result } = await read({ locator, find: 'BODY TEXT FOR PAGE 17' });
    expect(result.data).toMatchObject({
      mode: 'find',
      pages: { from: 1, to: 30 },
      has_more: false,
      find: { query: 'BODY TEXT FOR PAGE 17', hit_count: 1, hit_pages: [17], truncated: false },
    });
    expect(result.observation).toContain('[Page 17] Section 17 Body text for page 17.');
    expect(result.observation).toContain(`read_file(${JSON.stringify({ locator, pages: '17' })})`);
  });

  it('page_image 把单页渲染成图片并附加；模型不收图时只给尺寸', async () => {
    const locator = await writePdf([['Cover'], null]);
    const attached = await read({ locator, view: 'page_image', pages: '2' });
    expect(attached.result.data).toMatchObject({
      content_type: 'image/jpeg',
      pdf_page_number: 2,
      attachment_status: 'attached',
    });
    expect(attached.ingestImageBytes).toHaveBeenCalledTimes(1);
    expect([...attached.ingestImageBytes.mock.calls[0]![0].bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect('modelInput' in attached.result && attached.result.modelInput).toMatchObject({
      attachments: [{ uri: 'asset-claim://claim-1' }],
    });

    const notDelivered = await read({ locator, view: 'page_image', pages: '2' }, { imageAdmitted: false });
    expect(notDelivered.result.data).toMatchObject({ attachment_status: 'not_delivered', pdf_page_number: 2 });
    expect(notDelivered.ingestImageBytes).not.toHaveBeenCalled();
  });

  it('PDF 文字读取不要求模型看图，page_image 与不带 PDF 参数的物理文件仍要求', () => {
    const tool = new ReadFileTool();
    const locator = 'file:///tmp/report.pdf';
    expect(tool.resolveModelInputRequirement({ locator, pages: '3' })).toBeUndefined();
    expect(tool.resolveModelInputRequirement({ locator, find: 'tariff' })).toBeUndefined();
    expect(tool.resolveModelInputRequirement({ locator, view: 'page_image', pages: '3' }))
      .toMatchObject({ requires_image_input: true });
    expect(tool.resolveModelInputRequirement({ locator })).toMatchObject({ requires_image_input: true });
  });

  it('错误以稳定错误码返回：越界页、行窗口、非 PDF 用 PDF 参数、损坏文件', async () => {
    const locator = await writePdf([['Only page']]);
    const root = path.dirname(new URL(locator).pathname);
    const textLocator = formatHostFileLocator(path.join(root, 'notes.txt'));
    await fsp.writeFile(path.join(root, 'notes.txt'), 'plain text', 'utf8');
    const brokenLocator = formatHostFileLocator(path.join(root, 'broken.pdf'));
    await fsp.writeFile(path.join(root, 'broken.pdf'), '%PDF-1.7\n%%EOF', 'ascii');

    const { context } = createContext();
    const harness = createToolRuntimeHarness([new ReadFileTool()]);
    try {
      const cases: [Record<string, unknown>, string][] = [
        [{ locator, pages: '5' }, 'READ_FILE_PDF_PAGE_OUT_OF_RANGE'],
        [{ locator, offset: 2 }, 'READ_FILE_PDF_WINDOW_CONFLICT'],
        [{ locator: textLocator, pages: '1' }, 'READ_FILE_PDF_OPTION_UNSUPPORTED'],
        [{ locator: brokenLocator }, 'READ_FILE_PDF_UNREADABLE'],
        [{ locator, view: 'page_image', pages: '1-2' }, 'needs exactly one page'],
        [{ locator, pages: '1-25' }, 'read at most 20 PDF pages per call'],
      ];
      for (const [args, code] of cases) {
        const result = await harness.toolRuntime.executeTool('read_file', args, context);
        expect(result, JSON.stringify(args)).toMatchObject({ success: false, error: expect.stringContaining(code) });
      }
    } finally {
      harness.restore();
    }
  });
});
