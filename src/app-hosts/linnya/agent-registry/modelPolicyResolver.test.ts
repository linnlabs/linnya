import { describe, expect, it, vi } from 'vitest';

import { resolveModelIdFromPolicy } from './modelPolicyResolver';

describe('resolveModelIdFromPolicy kb_pdf_ocr', () => {
  it('知识库显式 PDF OCR 模型优先于 capability 默认模型', () => {
    const resolveByCapability = vi.fn(() => 'capability-ocr-model');

    const resolved = resolveModelIdFromPolicy(
      { kind: 'kb_pdf_ocr', defaultCapability: 'pdf_ocr_default' },
      {
        kbPdfOcrModelId: 'kb-explicit-ocr-model',
        resolveByCapability,
      }
    );

    expect(resolved).toBe('kb-explicit-ocr-model');
    expect(resolveByCapability).not.toHaveBeenCalled();
  });

  it('旧 visionModelId 不再作为 PDF OCR 覆盖，避免历史默认污染继续生效', () => {
    const resolveByCapability = vi.fn(() => 'capability-ocr-model');

    const resolved = resolveModelIdFromPolicy(
      { kind: 'kb_pdf_ocr', defaultCapability: 'pdf_ocr_default' },
      {
        kbVisionModelId: 'legacy-vision-model',
        resolveByCapability,
      }
    );

    expect(resolved).toBe('capability-ocr-model');
    expect(resolveByCapability).toHaveBeenCalledWith('pdf_ocr_default');
  });

  it('知识库未配置 OCR 模型时，按 policy 声明的 capability 解析默认模型', () => {
    const resolveByCapability = vi.fn(() => 'capability-ocr-model');

    const resolved = resolveModelIdFromPolicy(
      { kind: 'kb_pdf_ocr', defaultCapability: 'pdf_ocr_default' },
      {
        kbPdfOcrModelId: null,
        kbVisionModelId: null,
        defaultVisionModelId: 'static-fallback-model',
        resolveByCapability,
      }
    );

    expect(resolved).toBe('capability-ocr-model');
    expect(resolveByCapability).toHaveBeenCalledWith('pdf_ocr_default');
  });

  it('capability 无匹配时才使用静态兼容兜底', () => {
    const resolved = resolveModelIdFromPolicy(
      { kind: 'kb_pdf_ocr', defaultCapability: 'pdf_ocr_default' },
      {
        defaultVisionModelId: 'static-fallback-model',
        resolveByCapability: () => undefined,
      }
    );

    expect(resolved).toBe('static-fallback-model');
  });
});
