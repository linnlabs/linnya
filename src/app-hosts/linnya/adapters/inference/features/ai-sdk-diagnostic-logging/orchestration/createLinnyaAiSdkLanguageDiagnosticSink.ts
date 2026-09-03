import type {
  AiSdkLanguageDiagnostic,
  AiSdkLanguageDiagnosticSink,
} from '@linnlabs/linnkit-provider-ai-sdk';
import { Logger } from 'src/shared/logger';

function logDiagnostic(logger: Logger, diagnostic: AiSdkLanguageDiagnostic): void {
  switch (diagnostic.type) {
    case 'failure_projected':
      logger.warn('AI SDK failure 已投影为安全分类', {
        phase: diagnostic.phase,
        error_shape: diagnostic.error_shape,
        failure_kind: diagnostic.failure_kind,
        failure_code: diagnostic.failure_code,
        retryable: diagnostic.retryable,
      });
      return;
    case 'nonstandard_finish':
      logger.warn('Provider 返回了非标准结束原因', {
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
