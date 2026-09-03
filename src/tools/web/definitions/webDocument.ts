/** Web 页面读取在 Provider 与编排之间传递的稳定业务文档。 */
export type WebRenderMode = 'http' | 'js' | 'managed';

export type WebPageAccessBarrier = 'captcha' | 'login_required';

export type WebDocumentWarning =
  | 'readability_failed'
  | 'empty_content'
  | 'content_too_short'
  | 'low_text_ratio'
  | 'js_shell'
  | 'table_dominant'
  | 'list_dominant';

export interface WebDocument {
  /** 用户请求的原始 URL。 */
  url: string;
  /** 完成重定向或托管解析后的最终 URL。 */
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  byline?: string;
  siteName?: string;
  publishedAt?: string;
  language?: string;
  text: string;
  markdown?: string;
  rawHtmlRef?: string;
  extractor: string;
  renderMode: WebRenderMode;
  provider?: string;
  truncated: boolean;
  tokenCount?: number;
  rawLength: number;
  fetchedAt: string;
  /** HTTP 条件请求校验器；只在上游实际返回时保存。 */
  etag?: string;
  lastModified?: string;
  cacheAgeSeconds?: number;
  contentHash: string;
  /** 只有实际执行过质量评估的 Provider 才填写，禁止为托管结果伪造满分。 */
  qualityScore?: number;
  warnings: WebDocumentWarning[];
  blockedReason?: string;
  latencyMs: number;
  estimatedCost?: number;
}
