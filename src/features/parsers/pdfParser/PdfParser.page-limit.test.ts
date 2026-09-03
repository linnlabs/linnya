import { describe, expect, it, vi } from 'vitest';
import type { TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { PdfParser } from './PdfParser';

const mocks = vi.hoisted(() => ({
  tryQuickTextExtraction: vi.fn(),
  tryGeometricExtraction: vi.fn(),
  getPdfPageCountCrossPlatform: vi.fn(),
}));

vi.mock('./strategies/TextExtractionStrategy', () => ({
  tryQuickTextExtraction: mocks.tryQuickTextExtraction,
}));

vi.mock('./strategies/GeometricAnalysisStrategy', () => ({
  tryGeometricExtraction: mocks.tryGeometricExtraction,
}));

vi.mock('./adapters/PdfParseAdapter', () => ({
  getPdfPageCountCrossPlatform: mocks.getPdfPageCountCrossPlatform,
}));

vi.mock('src/app-hosts/linnya/agent-registry/modelPolicyResolver', () => ({
  resolveModelIdFromPolicy: vi.fn(() => 'ocr-model'),
}));

function makeTextGeneration(): TextGenerationPort {
  return { generate: vi.fn() };
}

function makeDocumentOcr(): DocumentOcrPort {
  return {
    resolveModelProfile: vi.fn().mockResolvedValue({
      modelId: 'ocr-model',
      displayName: 'OCR Model',
      mode: 'document_upload',
      supportsAbortSignal: true,
      attemptTimeoutMs: 300_000,
      maxInputPages: 100,
    }),
    recognizeDocument: vi.fn().mockRejectedValue(new Error('unexpected OCR call')),
  };
}

describe('PdfParser OCR 页数限制', () => {
  it('智能解析的文本提取成功时，不触发 OCR 页数限制', async () => {
    mocks.tryQuickTextExtraction.mockResolvedValue({
      success: true,
      blocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          text: '纯文本正文',
          source_info: { page_number: 1 },
        },
      ],
    });
    mocks.getPdfPageCountCrossPlatform.mockResolvedValue(150);
    const parser = new PdfParser({
      textGeneration: makeTextGeneration(),
      documentOcr: makeDocumentOcr(),
      visionModelId: 'ocr-model',
      filename: 'text.pdf',
      forceVisionMode: false,
    });

    const outcome = await parser.parseWithDiagnostics(new Uint8Array([1, 2, 3]), 'doc-1');

    expect(outcome.diagnostics.pipeline).toBe('text_extraction');
    expect(mocks.tryGeometricExtraction).not.toHaveBeenCalled();
  });

  it('智能解析进入视觉/OCR 层时，按当前 OCR 模型页数上限失败', async () => {
    mocks.tryQuickTextExtraction.mockResolvedValue({
      success: false,
      error: '文本密度过低',
    });
    mocks.tryGeometricExtraction.mockResolvedValue({
      success: false,
      error: '几何分析不可用',
    });
    mocks.getPdfPageCountCrossPlatform.mockResolvedValue(101);
    const parser = new PdfParser({
      textGeneration: makeTextGeneration(),
      documentOcr: makeDocumentOcr(),
      visionModelId: 'ocr-model',
      filename: 'scan.pdf',
      forceVisionMode: false,
    });

    await expect(parser.parseWithDiagnostics(new Uint8Array([1, 2, 3]), 'doc-2'))
      .rejects.toThrow('单次最多解析 100 页');
  });
});
