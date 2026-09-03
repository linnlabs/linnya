import { z } from 'zod';

export const WEB_CACHE_STATUS_VALUES = [
  'miss',
  'hit',
  'revalidated',
  'coalesced',
  'bypass',
] as const;
export const WebCacheStatusSchema = z.enum(WEB_CACHE_STATUS_VALUES);
export type WebCacheStatus = z.infer<typeof WebCacheStatusSchema>;

export const WEB_FAILURE_KIND_VALUES = [
  'timeout',
  'aborted',
  'body_too_large',
  'network_error',
  'rate_limited',
  'auth',
  'http_5xx',
  'http_error',
  'invalid_response',
  'policy_denied',
  'evidence_error',
  'extraction_error',
  'provider_error',
  'dns_error',
  'unsupported_mime',
  'http_403',
  'http_404',
  'empty_content',
  'captcha',
  'login_required',
  'js_required',
  'robots_block',
  'managed_disabled',
] as const;
export const WebFailureKindSchema = z.enum(WEB_FAILURE_KIND_VALUES);
export type WebFailureKind = z.infer<typeof WebFailureKindSchema>;

export const WEB_ESCALATABLE_FAILURE_KIND_VALUES = [
  'timeout',
  'network_error',
  'http_403',
  'captcha',
  'login_required',
  'js_required',
  'empty_content',
  'extraction_error',
] as const satisfies readonly WebFailureKind[];
export const EscalatableWebFailureKindSchema = z.enum(WEB_ESCALATABLE_FAILURE_KIND_VALUES);
export type EscalatableWebFailureKind = z.infer<typeof EscalatableWebFailureKindSchema>;

/**
 * 正文抽取失败发生的位置。failure kind 保持稳定、窄小；stage 只用于决定
 * 浏览器渲染是否具有独立恢复价值，以及成功兜底后的诊断观测。
 */
export const WEB_EXTRACTION_FAILURE_STAGE_VALUES = [
  'dom_canonicalization',
  'readability',
] as const;
export const WebExtractionFailureStageSchema = z.enum(WEB_EXTRACTION_FAILURE_STAGE_VALUES);
export type WebExtractionFailureStage = z.infer<typeof WebExtractionFailureStageSchema>;

export const WEB_READ_QUALITY_SIGNAL_VALUES = [
  'content_too_short',
  'table_list_dominant',
  'low_text_ratio',
] as const;
export const WebReadQualitySignalSchema = z.enum(WEB_READ_QUALITY_SIGNAL_VALUES);
export type WebReadQualitySignal = z.infer<typeof WebReadQualitySignalSchema>;

export const WEB_READ_ESCALATION_REASON_VALUES = [
  ...WEB_READ_QUALITY_SIGNAL_VALUES,
  ...WEB_ESCALATABLE_FAILURE_KIND_VALUES,
] as const;
export const WebReadEscalationReasonSchema = z.enum(WEB_READ_ESCALATION_REASON_VALUES);
export type WebReadEscalationReason = z.infer<typeof WebReadEscalationReasonSchema>;
