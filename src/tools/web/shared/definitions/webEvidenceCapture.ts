/** Web 领域交给外部持久化边界的抓取事实。 */
export type WebEvidenceCaptureKind = 'web_search_result' | 'web_page';

/**
 * Web 自己拥有的证据抓取 DTO。
 *
 * 这里使用 Web 的命名与语义，不复用 Evidence persistence record；
 * Host 组合层负责把它映射为目标 domain 的 write command。
 */
export interface WebEvidenceCaptureItem {
  readonly ref: string;
  readonly title: string;
  readonly snippet: string;
  readonly contentText: string;
  readonly capturedAtMs: number;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly siteName?: string;
  readonly publishedAt?: string;
  readonly captureKind: WebEvidenceCaptureKind;
}
