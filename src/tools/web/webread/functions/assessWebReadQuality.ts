import type {
  WebReadQualityAssessment,
  WebReadEscalationReason,
} from '../definitions/readLadder';
import type { WebReadResult } from '../providers/types';

const SUBSTANTIAL_CONTENT_CHARS = 800;

function findReadabilityEscalationReason(result: WebReadResult): WebReadEscalationReason | undefined {
  if (result.warnings.includes('empty_content')) return 'empty_content';
  if (result.warnings.includes('js_shell')) return 'js_required';
  if (result.warnings.includes('content_too_short')) return 'content_too_short';
  // 比例信号只说明 HTML 模板较重或正文结构特殊，不能推翻已经足量的正文。
  // 否则 Wikipedia、技术文档和列表型文章会在拿到数千字后仍被误升级。
  if (result.content.length < SUBSTANTIAL_CONTENT_CHARS
    && result.warnings.includes('low_text_ratio')) return 'low_text_ratio';
  if (result.content.length < SUBSTANTIAL_CONTENT_CHARS
    && (result.warnings.includes('table_dominant') || result.warnings.includes('list_dominant'))) {
    return 'table_list_dominant';
  }
  return undefined;
}

/**
 * 只依据可解释的质量信号升级。qualityScore 用于观测，不单独设置黑盒阈值；
 * 否则分数算法微调会在没有明确原因的情况下改变生产路由。
 */
export function assessWebReadQuality(result: WebReadResult): WebReadQualityAssessment {
  if ((result.renderMode !== 'http' && result.renderMode !== 'js')
    || (result.extractor !== 'readability' && result.extractor !== 'semantic_dom')) {
    return {
      shouldEscalate: false,
      ...(result.qualityScore !== undefined ? { qualityScore: result.qualityScore } : {}),
    };
  }

  const reason = findReadabilityEscalationReason(result);
  return {
    shouldEscalate: reason !== undefined,
    ...(reason ? { reason } : {}),
    ...(result.qualityScore !== undefined ? { qualityScore: result.qualityScore } : {}),
  };
}
