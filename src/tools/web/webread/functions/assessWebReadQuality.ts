import type {
  WebReadQualityAssessment,
  WebReadEscalationReason,
} from '../definitions/readLadder';
import type { WebReadResult } from '../providers/types';
import { WEB_READ_SUBSTANTIAL_CONTENT_CHARS } from '../definitions/readLadder';

function findReadabilityEscalationReason(result: WebReadResult): WebReadEscalationReason | undefined {
  // metadata_only 是有意返回的终态：正文未取得，但页面元数据/正式资源已经
  // 通过本地抽取器捕获。继续升级只会重复请求同一页，不能把资源变成正文。
  if (result.warnings.includes('metadata_only') && !result.warnings.includes('js_shell')) {
    return undefined;
  }
  if (result.warnings.includes('empty_content')) return 'empty_content';
  if (result.warnings.includes('js_shell')) return 'js_required';
  // tabular_dom 只有实际保留了多行独立数值的数据表才会产生。短数字表和正文
  // 字数不同，但空内容/JS 壳仍须升级，不能凭 extractor 名绕过这些检查。
  if (result.extractor === 'tabular_dom') return undefined;
  if (result.warnings.includes('content_too_short')) return 'content_too_short';
  // 比例信号只说明 HTML 模板较重或正文结构特殊，不能推翻已经足量的正文。
  // 否则 Wikipedia、技术文档和列表型文章会在拿到数千字后仍被误升级。
  if (result.content.length < WEB_READ_SUBSTANTIAL_CONTENT_CHARS
    && result.warnings.includes('low_text_ratio')) return 'low_text_ratio';
  if (result.content.length < WEB_READ_SUBSTANTIAL_CONTENT_CHARS
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
    || (result.extractor !== 'readability' && result.extractor !== 'semantic_dom'
      && result.extractor !== 'tabular_dom')) {
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
