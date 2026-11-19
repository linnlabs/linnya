import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiSdkLanguageDiagnostic } from '@linnlabs/linnkit-provider-ai-sdk';
import { Logger } from 'src/shared/logger';
import { createLinnyaAiSdkLanguageDiagnosticSink } from './createLinnyaAiSdkLanguageDiagnosticSink';

afterEach(() => vi.restoreAllMocks());

describe('AI SDK failure diagnostic logging', () => {
  it('保留投影失败的有限枚举，并拒绝 SDK 错误或分片正文越过日志白名单', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const sdkDetails = {
      response_data_state: 'absent' as const,
      cause_shape: 'transport_type_error' as const,
      http_status: 200, sdk_retryable: false,
      raw_body: 'sensitive-provider-body',
    };
    const diagnostic: AiSdkLanguageDiagnostic & { readonly error: Error; readonly text: string } = {
      type: 'failure_projected',
      attempt_id: 'attempt-stream-invariant',
      phase: 'provider_stream',
      error_shape: 'host_stream_invariant',
      invariant_code: 'text_delta_without_start',
      stream_part_type: 'text-delta',
      sdk_error_details: sdkDetails,
      failure_kind: 'protocol',
      failure_code: 'provider_stream_lifecycle_invalid',
      retryable: false,
      error: new Error('sensitive-provider-error'),
      text: 'sensitive-stream-content',
    };

    createLinnyaAiSdkLanguageDiagnosticSink().publish(diagnostic);

    expect(warn).toHaveBeenCalledExactlyOnceWith('AI SDK failure 已投影为安全分类', {
      attempt_id: 'attempt-stream-invariant',
      phase: 'provider_stream',
      error_shape: 'host_stream_invariant',
      invariant_code: 'text_delta_without_start',
      stream_part_type: 'text-delta',
      sdk_error_details: {
        response_data_state: 'absent', cause_shape: 'transport_type_error',
        http_status: 200, sdk_retryable: false,
      },
      failure_kind: 'protocol',
      failure_code: 'provider_stream_lifecycle_invalid',
      retryable: false,
    });
  });

  it('Provider 拒绝说明（已在 package 脱敏限长）原样写入失败诊断', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    createLinnyaAiSdkLanguageDiagnosticSink().publish({
      type: 'failure_projected',
      attempt_id: 'attempt-400',
      request_fingerprint: 'fingerprint-400',
      phase: 'provider_call',
      error_shape: 'api_call_error',
      sdk_error_details: { http_status: 400, sdk_retryable: false },
      provider_error_excerpt: 'Image at index 3 exceeds the size limit',
      failure_kind: 'provider',
      failure_code: 'provider_http_400',
      retryable: false,
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith('AI SDK failure 已投影为安全分类', expect.objectContaining({
      request_fingerprint: 'fingerprint-400',
      provider_error_excerpt: 'Image at index 3 exceeds the size limit',
      failure_code: 'provider_http_400',
    }));
  });
});
