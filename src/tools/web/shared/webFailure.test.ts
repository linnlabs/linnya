import { describe, expect, it } from 'vitest';
import { WebHttpError } from '../../../infra/adapters/web-http/webHttpFetch';
import {
  ESCALATABLE,
  WebFailureError,
  getWebExtractionFailureStage,
  getWebFailureDiagnostics,
  getWebAccessBlockKind,
  getWebFailureKind,
  isEscalatableWebFailureKind,
  isWebChallengeResponse,
  type EscalatableWebFailureKind,
  type WebFailureKind,
} from './webFailure';

describe('Web 终态失败分类与升级子集', () => {
  it('保留既有 kind，并把 HTTP 状态与 DNS 根因映射为具体终态', () => {
    expect(getWebFailureKind(new WebHttpError('timeout', 'timeout'))).toBe('timeout');
    expect(getWebFailureKind(new WebHttpError('auth', 'forbidden', { status: 403 }))).toBe('http_403');
    expect(getWebFailureKind(new WebHttpError('http_error', 'missing', { status: 404 }))).toBe('http_404');
    expect(getWebFailureKind(new WebHttpError('network_error', 'dns', {
      cause: { cause: { code: 'ENOTFOUND' } },
    }))).toBe('dns_error');
    expect(getWebFailureKind(new WebFailureError('unsupported_mime', 'binary'))).toBe('unsupported_mime');
  });

  it('增强读取未启用时公开可核实的阻断 code，保留阶梯 kind；缺码历史和超时不猜成阻断', () => {
    for (const reason of ['captcha', 'http_403', 'login_required'] as const) {
      const error = new WebFailureError('managed_disabled', 'managed reader disabled', {
        details: { previousFailureKind: reason },
      });
      expect(error.kind).toBe('managed_disabled');
      expect(error.code).toBe(reason);
      expect(getWebAccessBlockKind(error)).toBe(reason);
    }
    for (const reason of ['timeout', 'provider_error', 'js_required'] as const) {
      const error = new WebFailureError('managed_disabled', 'managed reader disabled', {
        details: { previousFailureKind: reason, initialFailureKind: 'captcha' },
      });
      expect(error.code).toBe('managed_disabled');
      expect(getWebAccessBlockKind(error)).toBeUndefined();
    }
    expect(getWebAccessBlockKind(new WebFailureError('managed_disabled', 'captcha in a message is not evidence'))).toBeUndefined();
  });

  it('ESCALATABLE 包含下一层可能恢复的失败，明确排除策略、取消、DNS、MIME 和 404', () => {
    const expected: EscalatableWebFailureKind[] = [
      'timeout',
      'network_error',
      'http_403',
      'captcha',
      'login_required',
      'js_required',
      'empty_content',
      'extraction_error',
    ];
    expect([...ESCALATABLE]).toEqual(expected);
    for (const kind of expected) expect(isEscalatableWebFailureKind(kind)).toBe(true);
    for (const kind of [
      'policy_denied',
      'aborted',
      'body_too_large',
      'dns_error',
      'http_5xx',
      'unsupported_mime',
      'http_404',
      'managed_disabled',
    ] satisfies WebFailureKind[]) {
      expect(isEscalatableWebFailureKind(kind)).toBe(false);
    }
  });

  it('只从正式抽取错误读取失败阶段', () => {
    const error = new WebFailureError('extraction_error', 'failed', {
      details: { extractionStage: 'dom_canonicalization' },
    });
    expect(getWebExtractionFailureStage(error)).toBe('dom_canonicalization');
    expect(getWebExtractionFailureStage({
      kind: 'provider_error',
      details: { extractionStage: 'readability' },
    })).toBeUndefined();
  });

  it('质量信号不冒充终态失败 kind', () => {
    expect(getWebFailureKind({ kind: 'content_too_short' })).toBe('provider_error');
    expect(getWebFailureKind({ kind: 'low_text_ratio' })).toBe('provider_error');
  });

  it('仅凭状态码不判定挑战，带有限页面特征才归类 captcha', () => {
    expect(getWebFailureKind(new WebHttpError('http_error', '419', { status: 419 }))).toBe('http_error');
    expect(isWebChallengeResponse(419, '<title>Human verification</title>')).toBe(true);
    expect(getWebFailureKind(new WebHttpError('http_error', 'challenge', {
      status: 419,
      challengeDetected: true,
    }))).toBe('captcha');
  });

  it('提取结构化失败诊断但不携带响应正文', () => {
    const error = new WebHttpError('http_5xx', 'upstream', {
      status: 503,
      url: 'https://example.com/article?token=secret',
      contentType: 'text/html',
      redirectCount: 1,
      attempt: 2,
      retryCount: 1,
    });
    expect(getWebFailureDiagnostics(error)).toEqual({
      status: 503,
      contentType: 'text/html',
      finalUrl: 'https://example.com/article',
      redirectCount: 1,
      attempt: 2,
      retryCount: 1,
    });
    expect(getWebFailureDiagnostics(error)).not.toHaveProperty('bodyPreview');
  });
});
