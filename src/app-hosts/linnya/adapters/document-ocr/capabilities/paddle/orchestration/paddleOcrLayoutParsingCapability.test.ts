import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { OcrProviderError } from 'src/domains/document-ocr';
import type { DocumentOcrCapabilityConfig } from '../../../definitions/documentOcrCapabilityConfig';
import { PaddleOcrLayoutParsingCapability } from './paddleOcrLayoutParsingCapability';

function makeConfig(): DocumentOcrCapabilityConfig {
  return {
    apiKey: 'token',
    route: {
      api_surface: 'paddle_layout_parsing',
      capability_id: 'host:paddle-ocr-layout-parsing',
      endpoint_id: 'paddleocr',
      endpoint_model_id: 'PaddlePaddle/PaddleOCR-VL-1.5',
      base_url: 'https://example.test/layout-parsing',
      auth_profile: 'token',
      mode: 'document_upload',
      supports_abort_signal: true,
      attempt_timeout_ms: 300_000,
      max_input_pages: 100,
    },
  };
}

async function createTempPdf(): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paddleocr-layout-test-'));
  const filePath = path.join(dir, 'sample.pdf');
  await fs.writeFile(filePath, Buffer.from('%PDF-1.4\n%%EOF'));
  return { dir, filePath };
}

describe('PaddleOcrLayoutParsingCapability', () => {
  const originalFetch = globalThis.fetch;
  type FetchCall = {
    input: RequestInfo | URL;
    init?: RequestInit;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('把 layoutParsingResults 解析为逐页 markdown', async () => {
    const { dir, filePath } = await createTempPdf();
    const fetchCalls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(
        JSON.stringify({
          result: {
            layoutParsingResults: [
              {
                markdown: {
                  text: '# 第一页',
                  images: { 'images/a.png': 'https://example.test/a.png' },
                },
                outputImages: { layout: 'https://example.test/layout-1.jpg' },
              },
              {
                markdown: {
                  text: '第二页正文',
                },
              },
            ],
          },
        }),
        { status: 200 }
      );
    };

    try {
      const adapter = new PaddleOcrLayoutParsingCapability(makeConfig());
      const result = await adapter.recognizeDocument({ kind: 'pdf_path', path: filePath });

      expect(result.totalPages).toBe(2);
      expect(result.pages).toEqual([
        {
          pageNumber: 1,
          markdown: '# 第一页',
          images: { 'images/a.png': 'https://example.test/a.png' },
          outputImages: { layout: 'https://example.test/layout-1.jpg' },
        },
        {
          pageNumber: 2,
          markdown: '第二页正文',
        },
      ]);

      const firstCall = fetchCalls[0];
      expect(firstCall.init?.headers).toMatchObject({
        Authorization: 'token token',
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(String(firstCall.init?.body));
      expect(body.fileType).toBe(0);
      expect(typeof body.file).toBe('string');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('单页图片输入保留原文档全局页码', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            layoutParsingResults: [
              {
                markdown: {
                  text: '失败页重跑结果',
                },
              },
            ],
          },
        }),
        { status: 200 }
      );

    const adapter = new PaddleOcrLayoutParsingCapability(makeConfig());
    const result = await adapter.recognizeDocument({
      kind: 'image_base64',
      base64: Buffer.from('image').toString('base64'),
      mimeType: 'image/jpeg',
      pageNumber: 9,
    });

    expect(result.pages).toEqual([
      {
        pageNumber: 9,
        markdown: '失败页重跑结果',
      },
    ]);
  });

  it('HTTP 错误抛出可分类的 OCR provider error', async () => {
    globalThis.fetch = async () =>
      new Response('invalid image data:image/png;base64,PROVIDER_ECHO_SECRET', {
        status: 429,
        statusText: 'Too Many Requests',
      });

    const adapter = new PaddleOcrLayoutParsingCapability(makeConfig());

    await expect(
      adapter.recognizeDocument({
        kind: 'image_base64',
        base64: Buffer.from('image').toString('base64'),
        mimeType: 'image/jpeg',
        pageNumber: 1,
      })
    ).rejects.toMatchObject({
      name: 'OcrProviderError',
      statusCode: 429,
      retryable: true,
    } satisfies Partial<OcrProviderError>);

    try {
      await adapter.recognizeDocument({
        kind: 'image_base64',
        base64: Buffer.from('image').toString('base64'),
        mimeType: 'image/jpeg',
        pageNumber: 1,
      });
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toMatch(
        /PROVIDER_ECHO_SECRET|data:image|base64/
      );
    }
  });
});
