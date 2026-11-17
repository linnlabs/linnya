import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentParsingInference } from '@linnya/plugin-host-contract/backend/documentParsingRuntime';
import type { DocumentOcrPort, TextGenerationPort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import { createTextPdf } from '../../features/parsers/pdfParser/testkit/createTextPdf';
import { countPluginPdfPages, parsePluginDocument, parsePluginPdfPages, generateParsedBlockId } from './documentParsingRuntime';

const directories: string[] = [];
async function directory() {
  const value = await mkdtemp(path.join(tmpdir(), 'linnya-parser-sdk-')); directories.push(value); return value;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(value => rm(value, { recursive: true, force: true }))); });
function inference() {
  const generate = vi.fn<TextGenerationPort['generate']>().mockRejectedValue(new Error('Unexpected model request'));
  const recognizeDocument = vi.fn<DocumentOcrPort['recognizeDocument']>().mockRejectedValue(new Error('Unexpected OCR request'));
  const resolveModelProfile = vi.fn<DocumentOcrPort['resolveModelProfile']>().mockResolvedValue(undefined);
  return { textGeneration: { generate }, documentOcr: { resolveModelProfile, recognizeDocument } } satisfies DocumentParsingInference;
}

it('复用真实文本/PDF解析与页数，不隐式选择模型或调用推理', async () => {
  const ports = inference();
  const temporaryDirectory = await directory();
  const text = await parsePluginDocument({ bytes: new TextEncoder().encode('First\n\nSecond'), documentId: 'text', filename: 'content.md', temporaryDirectory }, ports);
  expect(text.blocks.map(block => block.text)).toEqual(['First', 'Second']);
  expect(text.blocks.map(block => block.blockId)).toEqual(text.blocks.map((block, index) => generateParsedBlockId('text', index, block.text)));
  const pdf = createTextPdf([Array.from({ length: 15 }, (_, index) => `Line ${index} contains enough ordinary document text for accurate extraction.`)]);
  expect(await countPluginPdfPages(pdf)).toBe(1);
  const parsed = await parsePluginDocument({ bytes: pdf, documentId: 'pdf', filename: 'text.pdf', temporaryDirectory }, ports);
  expect(parsed.diagnostics).toMatchObject({ pipeline: 'text_extraction', parsedPages: [1] });
  expect(parsed.blocks[0]?.text).toContain('ordinary document text');
  expect(ports.textGeneration.generate).not.toHaveBeenCalled();
  expect(ports.documentOcr.resolveModelProfile).not.toHaveBeenCalled();
});

it('文档直传只使用显式OCR模型与任务临时目录，结束清理；指定页续跑保留原始页码', async () => {
  const ports = inference(); const temporaryDirectory = await directory();
  const pdf = createTextPdf([null, null]);
  ports.documentOcr.resolveModelProfile.mockResolvedValue({ modelId: 'selected-ocr', displayName: 'OCR', mode: 'document_upload', supportsAbortSignal: true, attemptTimeoutMs: 5000 });
  ports.documentOcr.recognizeDocument.mockImplementation(async request => {
    expect(request.modelId).toBe('selected-ocr');
    if (request.input.kind === 'pdf_path') {
      expect(path.relative(temporaryDirectory, request.input.path)).not.toMatch(/^\.\./);
      expect(await readFile(request.input.path)).toEqual(Buffer.from(pdf));
      return { pages: [{ pageNumber: 1, markdown: 'Saved page one' }, { pageNumber: 2, markdown: 'Saved page two' }] };
    }
    expect(request.input.pageNumber).toBe(2);
    return { pages: [{ pageNumber: 2, markdown: 'Recovered second page' }] };
  });
  const result = await parsePluginDocument({ bytes: pdf, documentId: 'scanned', filename: 'scanned.pdf', forceVisionMode: true, pdfOcrModelId: 'selected-ocr', temporaryDirectory }, ports);
  expect(result.diagnostics).toMatchObject({ pipeline: 'vision_document_upload', parsedPages: [1, 2] });
  expect(await readdir(temporaryDirectory)).toEqual([]);
  const pdfPath = path.join(temporaryDirectory, 'original.pdf'); await writeFile(pdfPath, pdf);
  const retry = await parsePluginPdfPages({ path: pdfPath, documentId: 'scanned', pages: [2], totalPages: 2, modelId: 'selected-ocr', temporaryDirectory }, ports);
  expect(retry).toMatchObject({ success: true, diagnostics: { parsedPages: [2] } });
  expect(ports.documentOcr.recognizeDocument).toHaveBeenCalledTimes(2);
  expect(ports.textGeneration.generate).not.toHaveBeenCalled();
});

it('图片退避期间取消后不再发送模型请求', async () => {
  const ports = inference(); const controller = new AbortController();
  ports.textGeneration.generate.mockResolvedValue({ text: '', reasoning: '', finishReason: 'stop' });
  const parsing = parsePluginDocument({ bytes: new Uint8Array([1]), documentId: 'image', filename: 'image.png', imageVisionModelId: 'frozen-vision', temporaryDirectory: await directory(), signal: controller.signal }, ports);
  const rejected = expect(parsing).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(ports.textGeneration.generate).toHaveBeenCalledOnce());
  controller.abort(); await rejected;
  expect(ports.textGeneration.generate).toHaveBeenCalledOnce();
  expect(ports.textGeneration.generate.mock.calls[0]?.[0]).toMatchObject({ modelId: 'frozen-vision', signal: controller.signal });
});

it('正在OCR时取消会中断在途请求、停止后续页，等待已启动页收口后释放资源', async () => {
  const ports = inference(); const controller = new AbortController();
  const signals: AbortSignal[] = [];
  ports.textGeneration.generate.mockImplementation(request => {
    const signal = request.signal;
    if (!signal) throw new Error('Missing cancellation signal');
    signals.push(signal);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const parsing = parsePluginDocument({ bytes: createTextPdf([null, null, null, null]), documentId: 'pages', filename: 'scan.pdf', forceVisionMode: true, pdfOcrModelId: 'frozen-vision', temporaryDirectory: await directory(), signal: controller.signal }, ports);
  const rejected = expect(parsing).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
  controller.abort(); await rejected;
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(ports.textGeneration.generate.mock.calls.length).toBeLessThanOrEqual(2);
});
