import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { OcrProviderError } from 'src/domains/document-ocr';
import type { DocumentOcrCapabilityConfig } from '../../../definitions/documentOcrCapabilityConfig';
import { PaddleOcrJobCapability } from './paddleOcrJobCapability';

function makeConfig(): DocumentOcrCapabilityConfig {
  return {
    apiKey: 'token',
    route: {
      api_surface: 'paddle_ocr_jobs',
      capability_id: 'host:paddle-ocr-jobs',
      endpoint_id: 'paddleocr',
      endpoint_model_id: 'PaddleOCR-VL-1.6',
      base_url: 'https://paddleocr.aistudio-app.com',
      auth_profile: 'bearer',
      mode: 'document_upload',
      supports_abort_signal: true,
      attempt_timeout_ms: 300_000,
      poll_interval_ms: 1,
    },
  };
}

async function createTempPdf(): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paddleocr-job-test-'));
  const filePath = path.join(dir, 'sample.pdf');
  await fs.writeFile(filePath, Buffer.from('%PDF-1.4\n%%EOF'));
  return { dir, filePath };
}

describe('PaddleOcrJobCapability', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('提交 job、轮询完成并解析 jsonl markdown', async () => {
    const { dir, filePath } = await createTempPdf();
    const progressEvents: Array<{ state: string; processedPages?: number }> = [];
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    globalThis.fetch = async (input, init) => {
      fetchCalls.push({ input, init });
      const url = String(input);

      if (url.endsWith('/api/v2/ocr/jobs')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ Authorization: 'bearer token' });
        expect(init?.body).toBeInstanceOf(FormData);
        const formData = init?.body as FormData;
        expect(formData.get('model')).toBe('PaddleOCR-VL-1.6');
        expect(JSON.parse(String(formData.get('optionalPayload')))).toEqual({
          useDocOrientationClassify: false,
          useDocUnwarping: false,
          useChartRecognition: false,
        });
        expect(formData.get('file')).toBeInstanceOf(Blob);
        return new Response(JSON.stringify({ data: { jobId: 'job-1' } }), { status: 200 });
      }

      if (url.endsWith('/api/v2/ocr/jobs/job-1')) {
        return new Response(
          JSON.stringify({
            data: {
              state: 'done',
              extractProgress: {
                totalPages: 2,
                extractedPages: 2,
              },
              resultUrl: {
                jsonUrl: 'https://result.test/result.jsonl',
              },
            },
          }),
          { status: 200 }
        );
      }

      if (url === 'https://result.test/result.jsonl') {
        return new Response(
          [
            JSON.stringify({
              result: {
                layoutParsingResults: [
                  {
                    markdown: {
                      text: '# 第一页',
                      images: { 'images/a.png': 'https://result.test/a.png' },
                    },
                    outputImages: { layout: 'https://result.test/layout-1.jpg' },
                  },
                  {
                    markdown: { text: '第二页正文' },
                  },
                ],
              },
            }),
          ].join('\n'),
          { status: 200 }
        );
      }

      throw new Error(`unexpected fetch: ${url}`);
    };

    try {
      const adapter = new PaddleOcrJobCapability(makeConfig());
      const result = await adapter.recognizeDocument(
        { kind: 'pdf_path', path: filePath },
        {
          onProgress: event =>
            progressEvents.push({
              state: event.state,
              processedPages: event.processedPages,
            }),
        }
      );

      expect(result).toEqual({
        totalPages: 2,
        pages: [
          {
            pageNumber: 1,
            markdown: '# 第一页',
            images: { 'images/a.png': 'https://result.test/a.png' },
            outputImages: { layout: 'https://result.test/layout-1.jpg' },
          },
          {
            pageNumber: 2,
            markdown: '第二页正文',
          },
        ],
      });
      expect(progressEvents).toEqual([
        { state: 'submitted', processedPages: undefined },
        { state: 'done', processedPages: 2 },
      ]);
      expect(fetchCalls).toHaveLength(3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('单页图片输入以当前全局页码作为结果页码起点', async () => {
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.endsWith('/api/v2/ocr/jobs')) {
        return new Response(JSON.stringify({ data: { jobId: 'job-image' } }), { status: 200 });
      }
      if (url.endsWith('/api/v2/ocr/jobs/job-image')) {
        return new Response(
          JSON.stringify({
            data: {
              state: 'done',
              resultUrl: { jsonUrl: 'https://result.test/image.jsonl' },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          result: {
            layoutParsingResults: [{ markdown: { text: '第七页恢复正文' } }],
          },
        }),
        { status: 200 }
      );
    };

    const adapter = new PaddleOcrJobCapability(makeConfig());
    const result = await adapter.recognizeDocument({
      kind: 'image_base64',
      base64: Buffer.from('image').toString('base64'),
      mimeType: 'image/jpeg',
      pageNumber: 7,
    });

    expect(result.pages).toEqual([
      {
        pageNumber: 7,
        markdown: '第七页恢复正文',
      },
    ]);
    expect(result.totalPages).toBeUndefined();
  });

  it('提交阶段 429 抛出可分类的 OCR provider error', async () => {
    globalThis.fetch = async () =>
      new Response('invalid image data:image/png;base64,PROVIDER_ECHO_SECRET', {
        status: 429,
        statusText: 'Too Many Requests',
      });

    const adapter = new PaddleOcrJobCapability(makeConfig());

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

  it('job failed 状态抛出非重试 provider error', async () => {
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.endsWith('/api/v2/ocr/jobs')) {
        return new Response(JSON.stringify({ data: { jobId: 'job-failed' } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: {
            state: 'failed',
            errorMsg: 'invalid image data:image/png;base64,PROVIDER_ECHO_SECRET',
          },
        }),
        { status: 200 }
      );
    };

    const adapter = new PaddleOcrJobCapability(makeConfig());

    await expect(
      adapter.recognizeDocument({
        kind: 'image_base64',
        base64: Buffer.from('image').toString('base64'),
        mimeType: 'image/jpeg',
        pageNumber: 1,
      })
    ).rejects.toMatchObject({
      name: 'OcrProviderError',
      retryable: false,
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
