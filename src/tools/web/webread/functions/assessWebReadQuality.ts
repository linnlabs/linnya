import type {
  WebReadQualityAssessment,
  WebReadEscalationReason,
} from '../definitions/readLadder';
import type { WebDocumentWarning } from '../../definitions/webDocument';
import type { WebReadResult } from '../providers/types';
import { WEB_READ_SUBSTANTIAL_CONTENT_CHARS } from '../definitions/readLadder';

const HTTP_DYNAMIC_ESCALATION_WARNINGS: readonly WebDocumentWarning[] = [
  'embedded_same_origin_iframe',
  'hidden_main_content',
  'dynamic_content_pending',
];

const SHORT_NOTICE_MIN_PLAIN_CHARS = 120;
const SHORT_NOTICE_MIN_WEIGHTED_UNITS = 220;
const CJK_CHAR_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const FORMAL_DOCUMENT_FILE_URL_PATTERN = /\.(?:pdf|docx?|xlsx?|pptx?|csv|tsv|wps|ofd)(?:$|[?#])/i;
const PROSE_SENTENCE_PATTERN = /[^。！？.!?\n]{18,}[。！？.!?]/;

function measureVisibleMarkdownText(content: string): {
  readonly plain: string;
  readonly plainLength: number;
  readonly weightedUnits: number;
} {
  const plain = content
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let weightedUnits = 0;
  for (const char of plain) {
    if (char === ' ') continue;
    weightedUnits += CJK_CHAR_PATTERN.test(char) ? 2 : 1;
  }
  return { plain, plainLength: plain.length, weightedUnits };
}

/**
 * 政务/机构正式转文通知原文常常只有 150–199 字，核心正文随附在正式 PDF/DOCX 附件中。
 * 只有同时满足“含具备正式文档扩展名的 document 附件”“无访问屏障/动态壳信号”
 * “去链接和格式后仍有足够实体文字且至少含一句完整陈述句”才作为完整短通知放行，
 * 避免通用 `/download` 落地页与无句号的导航占位壳误放行。
 */
function isCompleteShortNoticeWithDocument(result: WebReadResult): boolean {
  if (result.blockedReason) return false;
  if (result.warnings.includes('table_dominant') || result.warnings.includes('list_dominant')) {
    return false;
  }
  const hasFormalDocumentFile = (result.resources ?? []).some(
    (resource) =>
      resource.kind === 'document' && FORMAL_DOCUMENT_FILE_URL_PATTERN.test(resource.url),
  );
  if (!hasFormalDocumentFile) return false;
  const { plain, plainLength, weightedUnits } = measureVisibleMarkdownText(result.content);
  return (
    plainLength >= SHORT_NOTICE_MIN_PLAIN_CHARS
    && weightedUnits >= SHORT_NOTICE_MIN_WEIGHTED_UNITS
    && PROSE_SENTENCE_PATTERN.test(plain)
  );
}

function findReadabilityEscalationReason(result: WebReadResult): WebReadEscalationReason | undefined {
  // 同源内容 iframe、主区隐藏待揭示正文与半静态水合壳允许越过 metadata_only 终态，
  // 交由本地 Chromium 渲染一次；纯附件目录与跨源 iframe 保持 metadata_only 终态。
  if (
    result.renderMode === 'http'
    && HTTP_DYNAMIC_ESCALATION_WARNINGS.some((warning) => result.warnings.includes(warning))
  ) {
    return 'js_required';
  }
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
  if (isCompleteShortNoticeWithDocument(result)) return undefined;
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

/** 已有可读正文，仅在首跳缺少整块示例时尝试补取；其他升级原因由正常阶梯处理。 */
export function shouldRenderEmbeddedCode(result: WebReadResult): boolean {
  return result.renderMode === 'http' && result.warnings.includes('embedded_code_pending')
    && !result.warnings.includes('metadata_only') && !hasFencedCode(result);
}

function hasFencedCode(result: WebReadResult): boolean {
  // 本地 Markdown 转换器使用反引号围栏。逐行配对，截断在示例中间不算已补全。
  let fenceLength = 0;
  let hasCode = false;
  for (const line of (result.markdown ?? '').split('\n')) {
    if (!fenceLength) {
      fenceLength = /^(`{3,})[^`]*$/.exec(line)?.[1]?.length ?? 0;
    } else if (/^`{3,}\s*$/.test(line) && line.trimEnd().length >= fenceLength) {
      if (hasCode) return true;
      fenceLength = 0;
    } else if (line.trim()) {
      hasCode = true;
    }
  }
  return false;
}

export function hasRenderedCodeExample(initial: WebReadResult, rendered: WebReadResult): boolean {
  if (rendered.finalUrl !== initial.finalUrl || !hasFencedCode(rendered)
    || assessWebReadQuality(rendered).shouldEscalate) return false;
  // 单独挂载的编辑器可能替换整篇教程；至少要仍能定位首跳的首段，才用渲染视图交付。
  const firstBodyLine = initial.content.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#'));
  return firstBodyLine !== undefined && rendered.content.includes(firstBodyLine);
}
