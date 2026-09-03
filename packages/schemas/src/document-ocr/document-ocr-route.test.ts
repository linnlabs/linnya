import { describe, expect, it } from 'vitest';
import { DocumentOcrRouteSchema } from './document-ocr-route';

describe('DocumentOcrRouteSchema', () => {
  it('接纳显式 Paddle layout route 并规范 base URL', () => {
    const route = DocumentOcrRouteSchema.parse({
      api_surface: 'paddle_layout_parsing',
      capability_id: 'host:paddle-ocr-layout-parsing',
      endpoint_id: 'paddleocr',
      endpoint_model_id: 'PaddlePaddle/PaddleOCR-VL-1.5',
      base_url: 'https://example.test/layout-parsing/',
      auth_profile: 'token',
      mode: 'document_upload',
      supports_abort_signal: true,
      attempt_timeout_ms: 300_000,
      max_input_pages: 100,
    });

    expect(route.base_url).toBe('https://example.test/layout-parsing');
  });

  it('job surface 必须声明轮询间隔和对应 capability', () => {
    expect(() =>
      DocumentOcrRouteSchema.parse({
        api_surface: 'paddle_ocr_jobs',
        capability_id: 'host:paddle-ocr-layout-parsing',
        endpoint_id: 'paddleocr',
        endpoint_model_id: 'PaddleOCR-VL-1.6',
        base_url: 'https://example.test',
        auth_profile: 'bearer',
        mode: 'document_upload',
        supports_abort_signal: true,
        attempt_timeout_ms: 300_000,
      })
    ).toThrow();
  });

  it('拒绝未注册 surface 和额外兼容字段', () => {
    expect(() =>
      DocumentOcrRouteSchema.parse({
        api_surface: 'generic_ocr',
        capability_id: 'host:generic-ocr',
        endpoint_id: 'custom',
        endpoint_model_id: 'ocr-model',
        base_url: 'https://example.test',
        auth_profile: 'bearer',
        mode: 'document_upload',
        supports_abort_signal: true,
        attempt_timeout_ms: 30_000,
        adapter: 'paddleocr',
      })
    ).toThrow();
  });
});
