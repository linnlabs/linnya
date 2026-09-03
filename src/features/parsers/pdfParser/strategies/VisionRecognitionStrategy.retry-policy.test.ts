import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextGenerationFailure, type TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { processWithVisionDiagnostics, recognizeImageContent } from './VisionRecognitionStrategy';

const mocks = vi.hoisted(() => ({
  getPdfPageCountCrossPlatform: vi.fn(),
  convertPageToJpegCrossPlatform: vi.fn(),
}));

vi.mock('../adapters/PdfParseAdapter', () => ({
  getPdfPageCountCrossPlatform: mocks.getPdfPageCountCrossPlatform,
}));

vi.mock('../adapters/PdfToImgAdapter', () => ({
  DEFAULT_TARGET_PIXELS: 2048,
  convertPageToJpegCrossPlatform: mocks.convertPageToJpegCrossPlatform,
}));

function makeTextGeneration(generate: TextGenerationPort['generate']): TextGenerationPort {
  return { generate };
}

function makeDocumentOcr(): DocumentOcrPort {
  return {
    resolveModelProfile: vi.fn().mockResolvedValue(undefined),
    recognizeDocument: vi.fn().mockRejectedValue(new Error('unexpected document OCR call')),
  };
}

describe('VisionRecognitionStrategy OCR retry policy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('认证错误不重试，直接暴露 auth 分类可识别的 provider error', async () => {
    const authError = new TextGenerationFailure(
      'provider',
      'provider_http_401',
      false,
      'unauthorized'
    );
    const generate = vi.fn<TextGenerationPort['generate']>().mockRejectedValue(authError);
    const textGeneration = makeTextGeneration(generate);

    await expect(
      recognizeImageContent('image-base64', 1, textGeneration, 'vision-model', {
        maxRetries: 3,
        attemptTimeoutMs: 30_000,
      })
    ).rejects.toBe(authError);

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('429 会按分类重试并在成功后返回内容', async () => {
    vi.useFakeTimers();
    const generate = vi
      .fn<TextGenerationPort['generate']>()
      .mockRejectedValueOnce(
        new TextGenerationFailure('provider', 'provider_http_429', true, 'too many requests')
      )
      .mockResolvedValueOnce({ text: '恢复后的正文', reasoning: '', finishReason: 'stop' });
    const textGeneration = makeTextGeneration(generate);

    const resultPromise = recognizeImageContent('image-base64', 2, textGeneration, 'vision-model', {
      maxRetries: 3,
      attemptTimeoutMs: 30_000,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(resultPromise).resolves.toBe('恢复后的正文');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('空内容重试耗尽后保留 empty_content 分类 cause', async () => {
    vi.useFakeTimers();
    const generate = vi.fn<TextGenerationPort['generate']>().mockResolvedValue({
      text: '',
      reasoning: '',
      finishReason: 'stop',
    });
    const textGeneration = makeTextGeneration(generate);

    const resultPromise = recognizeImageContent('image-base64', 3, textGeneration, 'vision-model', {
      maxRetries: 2,
      attemptTimeoutMs: 30_000,
    });
    const expectation = expect(resultPromise).rejects.toMatchObject({
      cause: expect.objectContaining({
        name: 'EmptyOcrContentError',
      }),
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expectation;
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('整篇视觉解析遇到认证错误时返回可操作失败提示', async () => {
    mocks.getPdfPageCountCrossPlatform.mockResolvedValue(1);
    mocks.convertPageToJpegCrossPlatform.mockResolvedValue('image-base64');
    const authError = new TextGenerationFailure(
      'provider',
      'provider_http_401',
      false,
      'unauthorized'
    );
    const textGeneration = makeTextGeneration(
      vi.fn<TextGenerationPort['generate']>().mockRejectedValue(authError)
    );

    const outcome = await processWithVisionDiagnostics(
      new Uint8Array([1, 2, 3]),
      'doc-1',
      textGeneration,
      makeDocumentOcr(),
      'vision-model',
      { maxRetries: 3 }
    );

    expect(outcome.success).toBe(false);
    if (outcome.success) {
      throw new Error('expected failure');
    }
    expect(outcome.error).toContain('OCR 模型认证失败');
    expect(outcome.error).toContain('API key');
  });

  it('page_image 主链路遇到认证错误后不继续启动后续 OCR 请求', async () => {
    mocks.getPdfPageCountCrossPlatform.mockResolvedValue(4);
    mocks.convertPageToJpegCrossPlatform.mockImplementation(
      async (_pdfPath: string, pageNum: number) => `image-${pageNum}`
    );

    let activeCalls = 0;
    const releaseByCall: Array<() => void> = [];
    const generate = vi.fn<TextGenerationPort['generate']>().mockImplementation(() => {
      activeCalls += 1;
      const callNumber = activeCalls;
      return new Promise((resolve, reject) => {
        releaseByCall[callNumber] = () => {
          if (callNumber === 1) {
            reject(
              new TextGenerationFailure('provider', 'provider_http_401', false, 'unauthorized')
            );
            return;
          }
          resolve({ text: `第 ${callNumber} 页正文`, reasoning: '', finishReason: 'stop' });
        };
      });
    });
    const textGeneration = makeTextGeneration(generate);

    const outcomePromise = processWithVisionDiagnostics(
      new Uint8Array([1, 2, 3]),
      'doc-auth-abort',
      textGeneration,
      makeDocumentOcr(),
      'vision-model',
      { maxRetries: 1 }
    );

    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    releaseByCall[1]();
    releaseByCall[2]();

    const outcome = await outcomePromise;

    expect(outcome.success).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2);
    if (outcome.success) {
      throw new Error('expected failure');
    }
    expect(outcome.error).toContain('OCR 模型认证失败');
  });

  it('page_image 主链路初始并发为 2，遇到 429 后后续降为 1', async () => {
    vi.useFakeTimers();
    mocks.getPdfPageCountCrossPlatform.mockResolvedValue(4);
    mocks.convertPageToJpegCrossPlatform.mockImplementation(
      async (_pdfPath: string, pageNum: number) => `image-${pageNum}`
    );

    let activeCalls = 0;
    let maxActiveCalls = 0;
    const callStarts: number[] = [];
    const releaseByCall: Array<() => void> = [];
    const generate = vi.fn<TextGenerationPort['generate']>().mockImplementation(() => {
      const callNumber = callStarts.length + 1;
      callStarts.push(callNumber);
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

      return new Promise((resolve, reject) => {
        releaseByCall[callNumber] = () => {
          activeCalls -= 1;
          if (callNumber === 1) {
            reject(
              new TextGenerationFailure('provider', 'provider_http_429', true, 'too many requests')
            );
            return;
          }
          resolve({ text: `第 ${callNumber} 页正文`, reasoning: '', finishReason: 'stop' });
        };
      });
    });
    const textGeneration = makeTextGeneration(generate);

    const outcomePromise = processWithVisionDiagnostics(
      new Uint8Array([1, 2, 3]),
      'doc-adaptive',
      textGeneration,
      makeDocumentOcr(),
      'vision-model',
      { maxRetries: 1 }
    );

    await vi.waitFor(() => expect(callStarts).toEqual([1, 2]));
    expect(maxActiveCalls).toBe(2);

    releaseByCall[1]();
    await vi.waitFor(() => expect(callStarts).toEqual([1, 2]));

    releaseByCall[2]();
    await vi.waitFor(() => expect(callStarts).toEqual([1, 2, 3]));
    expect(activeCalls).toBe(1);

    releaseByCall[3]();
    await vi.waitFor(() => expect(callStarts).toEqual([1, 2, 3, 4]));
    expect(activeCalls).toBe(1);

    releaseByCall[4]();
    const outcome = await outcomePromise;

    expect(outcome.success).toBe(true);
    if (!outcome.success) {
      throw new Error(outcome.error);
    }
    expect(outcome.diagnostics.failedPages).toHaveLength(1);
    expect(outcome.diagnostics.failedPages[0]).toMatchObject({
      pageNumber: 1,
      errorKind: 'rate_limited',
      shouldReduceConcurrency: true,
    });
  });
});
