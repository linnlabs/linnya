import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';

const mocks = vi.hoisted(() => ({
  convertPageToJpegCrossPlatform: vi.fn(),
}));

vi.mock('../adapters/PdfToImgAdapter', () => ({
  DEFAULT_TARGET_PIXELS: 2048,
  convertPageToJpegCrossPlatform: mocks.convertPageToJpegCrossPlatform,
}));

import { processPdfPagesWithVisionDiagnostics } from './VisionRecognitionStrategy';

function makeTextGeneration(): TextGenerationPort {
  return { generate: vi.fn() };
}

describe('processPdfPagesWithVisionDiagnostics document_upload 续跑', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('失败页续跑使用 OCR adapter 识别单页图片，不把 PaddleOCR 送进 chatCompletion', async () => {
    mocks.convertPageToJpegCrossPlatform.mockResolvedValue('page-image-base64');

    const recognizeDocument = vi.fn<DocumentOcrPort['recognizeDocument']>().mockResolvedValue({
      pages: [
        {
          pageNumber: 7,
          markdown: '第七页恢复正文',
        },
      ],
    });
    const documentOcr: DocumentOcrPort = {
      resolveModelProfile: vi.fn().mockResolvedValue({
        modelId: 'PaddlePaddle/PaddleOCR-VL-1.5',
        displayName: 'PaddleOCR',
        mode: 'document_upload',
        supportsAbortSignal: true,
        attemptTimeoutMs: 30_000,
      }),
      recognizeDocument,
    };

    const textGeneration = makeTextGeneration();
    const outcome = await processPdfPagesWithVisionDiagnostics(
      '/tmp/source.pdf',
      'doc-1',
      [7],
      10,
      textGeneration,
      documentOcr,
      'PaddlePaddle/PaddleOCR-VL-1.5',
      { maxRetries: 1 }
    );

    expect(outcome.success).toBe(true);
    if (!outcome.success) {
      throw new Error(outcome.error);
    }
    expect(outcome.diagnostics.pipeline).toBe('vision_document_upload');
    expect(outcome.diagnostics.parsedPages).toEqual([7]);
    expect(outcome.blocks).toHaveLength(1);
    expect(outcome.blocks[0].source_info?.page_number).toBe(7);
    expect(textGeneration.generate).not.toHaveBeenCalled();
    expect(recognizeDocument).toHaveBeenCalledWith({
      modelId: 'PaddlePaddle/PaddleOCR-VL-1.5',
      input: {
        kind: 'image_base64',
        base64: 'page-image-base64',
        mimeType: 'image/jpeg',
        pageNumber: 7,
      },
      options: {
        signal: expect.any(AbortSignal),
      },
    });
  });
});
