import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { createInMemoryProviderOutboundAudit } from 'src/domains/audit/features/provider-outbound-audit';
import { createDocumentOcrPort, type DocumentOcrModelCatalog } from './createDocumentOcrPort';

function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'ocr-model',
    model_name: 'PaddlePaddle/PaddleOCR-VL-1.5',
    catalog_source: 'default',
    capabilities: ['vision', 'document_ocr'],
    ui_visibility: ['vision'],
    display_name: 'OCR Model',
    description: '',
    document_ocr_route: {
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
    ...overrides,
  };
}

function createCatalog(model: ModelConfig | undefined): DocumentOcrModelCatalog {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getModel: vi.fn().mockReturnValue(model),
    resolveCredential: vi.fn().mockReturnValue('token'),
  };
}

describe('createDocumentOcrPort', () => {
  it('严格投影 OCR 模型的文档识别 profile', async () => {
    const port = createDocumentOcrPort({ catalog: createCatalog(makeConfig()) });

    await expect(port.resolveModelProfile('ocr-model')).resolves.toEqual({
      modelId: 'ocr-model',
      displayName: 'OCR Model',
      mode: 'document_upload',
      supportsAbortSignal: true,
      attemptTimeoutMs: 300_000,
      maxInputPages: 100,
    });
  });

  it('非 OCR 模型不伪造 profile', async () => {
    const port = createDocumentOcrPort({
      catalog: createCatalog(
        makeConfig({ capabilities: ['vision'], document_ocr_route: undefined })
      ),
    });

    await expect(port.resolveModelProfile('ocr-model')).resolves.toBeUndefined();
  });

  it('缺少显式 route 时拒绝执行文档识别', async () => {
    const port = createDocumentOcrPort({
      catalog: createCatalog(makeConfig({ document_ocr_route: undefined })),
    });

    await expect(
      port.recognizeDocument({
        modelId: 'ocr-model',
        input: {
          kind: 'image_base64',
          base64: 'image',
          mimeType: 'image/jpeg',
          pageNumber: 1,
        },
      })
    ).rejects.toThrow("模型 'ocr-model' 未声明 document_ocr_route");
  });

  it('真实 OCR transport 写入统一安全快照，不保存 base64、密钥或 URL', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          result: { layoutParsingResults: [{ markdown: { text: '识别结果' } }] },
        }),
        { status: 200 }
      );
    const outboundAudit = createInMemoryProviderOutboundAudit();
    const port = createDocumentOcrPort({
      catalog: createCatalog(makeConfig()),
      outbound_audit: outboundAudit,
    });

    try {
      await expect(
        port.recognizeDocument({
          modelId: 'ocr-model',
          input: {
            kind: 'image_base64',
            base64: 'BASE64_SECRET',
            mimeType: 'image/jpeg',
            pageNumber: 9,
          },
        })
      ).resolves.toMatchObject({ pages: [{ pageNumber: 9, markdown: '识别结果' }] });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(outboundAudit.readLatest()).toMatchObject({
      operation: 'document_ocr',
      status: 'succeeded',
      input: { kind: 'document_ocr', input_kind: 'image' },
      usage: { provenance: 'not_reported' },
    });
    const serialized = JSON.stringify(outboundAudit.readLatest());
    for (const sensitive of ['BASE64_SECRET', 'token', 'example.test', '识别结果']) {
      expect(serialized).not.toContain(sensitive);
    }
  });
});
