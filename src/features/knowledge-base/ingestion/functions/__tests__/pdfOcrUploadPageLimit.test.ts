import { describe, expect, it, vi } from 'vitest';
import type { DocumentOcrModelProfile, DocumentOcrPort } from 'src/domains/document-ocr';
import type { KnowledgeBaseLookupPort } from '../pdfOcrUploadPageLimit';
import { validatePdfOcrUploadPageLimit } from 'src/features/knowledge-base/ingestion/functions/pdfOcrUploadPageLimit';

function makeKbLookup(overrides: Partial<KnowledgeBaseLookupPort> = {}): KnowledgeBaseLookupPort {
  return {
    getKnowledgeBaseById: vi.fn().mockResolvedValue({
      pdfOcrModelId: null,
      visionModelId: null,
    }),
    ...overrides,
  };
}

function makeDocumentOcr(overrides: Partial<DocumentOcrModelProfile> = {}): DocumentOcrPort {
  return {
    resolveModelProfile: vi.fn().mockResolvedValue({
      modelId: 'PaddlePaddle/PaddleOCR-VL-1.5',
      displayName: 'PaddleOCR-VL-1.5',
      mode: 'document_upload',
      supportsAbortSignal: true,
      attemptTimeoutMs: 300_000,
      maxInputPages: 100,
      ...overrides,
    }),
    recognizeDocument: vi.fn().mockRejectedValue(new Error('unexpected OCR call')),
  };
}

describe('validatePdfOcrUploadPageLimit', () => {
  it('PDF 页数等于模型上限时允许上传', async () => {
    await expect(
      validatePdfOcrUploadPageLimit({
        kbLookup: makeKbLookup(),
        kbId: 'kb-1',
        filename: 'sample.pdf',
        filePath: '/tmp/sample.pdf',
        requestedPdfOcrModelId: undefined,
        documentOcr: makeDocumentOcr(),
        deps: {
          getDefaultModelId: () => 'PaddlePaddle/PaddleOCR-VL-1.5',
          getPageCount: async () => 100,
        },
      })
    ).resolves.toBeUndefined();
  });

  it('PDF 页数超过 document_upload 模型上限时拒绝上传', async () => {
    await expect(
      validatePdfOcrUploadPageLimit({
        kbLookup: makeKbLookup(),
        kbId: 'kb-1',
        filename: 'large.pdf',
        filePath: '/tmp/large.pdf',
        requestedPdfOcrModelId: undefined,
        documentOcr: makeDocumentOcr(),
        deps: {
          getDefaultModelId: () => 'PaddlePaddle/PaddleOCR-VL-1.5',
          getPageCount: async () => 101,
        },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('单次最多解析 100 页'),
    });
  });

  it('未声明页数上限的视觉模型不触发页数闸门', async () => {
    const getPageCount = vi.fn(async () => 500);

    await expect(
      validatePdfOcrUploadPageLimit({
        kbLookup: makeKbLookup(),
        kbId: 'kb-1',
        filename: 'large.pdf',
        filePath: '/tmp/large.pdf',
        requestedPdfOcrModelId: 'vision-model',
        documentOcr: makeDocumentOcr({ maxInputPages: undefined }),
        deps: {
          getPageCount,
        },
      })
    ).resolves.toBeUndefined();

    expect(getPageCount).not.toHaveBeenCalled();
  });
});
