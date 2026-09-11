import type {
  AiSdkLanguageDiagnostic,
  AiSdkLanguageDiagnosticSink,
} from '@linnlabs/linnkit-provider-ai-sdk';
import { Logger } from 'src/shared/logger';

function logDiagnostic(logger: Logger, diagnostic: AiSdkLanguageDiagnostic): void {
  switch (diagnostic.type) {
    case 'attempt_observed':
      logger.info('AI SDK inference attempt 观测', {
        attempt_id: diagnostic.attempt_id,
        capability_id: diagnostic.capability_id,
        api_surface: diagnostic.surface,
        endpoint_id: diagnostic.endpoint_id,
        endpoint_model_id: diagnostic.endpoint_model_id,
        request_fingerprint: diagnostic.request_fingerprint,
        message_count: diagnostic.message_count,
        message_roles: diagnostic.message_roles,
        image_message_roles: diagnostic.image_message_roles,
        tool_count: diagnostic.tool_count,
        text_characters: diagnostic.text_characters,
        estimated_input_tokens: diagnostic.estimated_input_tokens,
        image_count: diagnostic.image_count,
        image_bytes: diagnostic.image_bytes,
        image_media_types: diagnostic.image_media_types,
        retry_count: diagnostic.retry_count,
        terminal_event_received: diagnostic.terminal_event_received,
        ...(diagnostic.terminal_event_type === undefined
          ? {}
          : { terminal_event_type: diagnostic.terminal_event_type }),
        ...(diagnostic.last_provider_part_type === undefined
          ? {}
          : { last_provider_part_type: diagnostic.last_provider_part_type }),
      });
      return;
    case 'failure_projected':
      logger.warn('AI SDK failure 已投影为安全分类', {
        ...(diagnostic.attempt_id === undefined ? {} : { attempt_id: diagnostic.attempt_id }),
        ...(diagnostic.request_fingerprint === undefined
          ? {}
          : { request_fingerprint: diagnostic.request_fingerprint }),
        phase: diagnostic.phase,
        error_shape: diagnostic.error_shape,
        ...(diagnostic.provider_signal === undefined
          ? {}
          : { provider_signal: diagnostic.provider_signal }),
        failure_kind: diagnostic.failure_kind,
        failure_code: diagnostic.failure_code,
        retryable: diagnostic.retryable,
      });
      return;
    case 'nonstandard_finish':
      logger.warn('Provider 返回了非标准结束原因', {
        ...(diagnostic.attempt_id === undefined ? {} : { attempt_id: diagnostic.attempt_id }),
        ...(diagnostic.request_fingerprint === undefined
          ? {}
          : { request_fingerprint: diagnostic.request_fingerprint }),
        capability_id: diagnostic.capability_id,
        api_surface: diagnostic.surface,
        finish_reason: diagnostic.finish_reason,
        raw_finish_reason_category: diagnostic.raw_finish_reason_category,
        projected_event_type: diagnostic.projected_event_type,
        ...(diagnostic.projected_code === undefined
          ? {}
          : { projected_code: diagnostic.projected_code }),
        ...(diagnostic.projected_reason === undefined
          ? {}
          : { projected_reason: diagnostic.projected_reason }),
        ...(diagnostic.retryable === undefined ? {} : { retryable: diagnostic.retryable }),
      });
      return;
    case 'stream_idle_timeout':
      logger.warn('AI SDK stream 达到内容分片空闲上限', {
        ...(diagnostic.attempt_id === undefined ? {} : { attempt_id: diagnostic.attempt_id }),
        ...(diagnostic.request_fingerprint === undefined
          ? {}
          : { request_fingerprint: diagnostic.request_fingerprint }),
        capability_id: diagnostic.capability_id,
        api_surface: diagnostic.surface,
        idle_timeout_ms: diagnostic.idle_timeout_ms,
      });
      return;
  }
}

/** package 只发布白名单诊断；Host 决定日志文案、级别与 logger 实现。 */
export function createLinnyaAiSdkLanguageDiagnosticSink(): AiSdkLanguageDiagnosticSink {
  const logger = new Logger('AiSdkInference');
  return {
    publish: diagnostic => logDiagnostic(logger, diagnostic),
  };
}
