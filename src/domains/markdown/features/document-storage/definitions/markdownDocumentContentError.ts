/**
 * 单篇文档的正文读不出来时抛出；只影响这一篇，目录与其他文档照常可用。
 *
 * - `unreadable`：正文不是合法 JSON，无法读取；
 * - `invalid_format`：JSON 可以解析，但不符合 Markdown 文档格式。
 */
export type MarkdownDocumentContentFailure = 'unreadable' | 'invalid_format';

const MAX_DETAIL_LENGTH = 200;

export class MarkdownDocumentContentError extends Error {
  constructor(
    readonly failure: MarkdownDocumentContentFailure,
    readonly documentNodeId: string,
    readonly cause: unknown,
  ) {
    const raw = (cause instanceof Error ? cause.message : String(cause)).trim();
    const detail = raw.length > MAX_DETAIL_LENGTH ? `${raw.slice(0, MAX_DETAIL_LENGTH - 1)}…` : raw;
    const summary = failure === 'unreadable'
      ? '这篇文档的正文已损坏，无法读取'
      : '这篇文档的格式不正确，无法打开';
    super(detail.length > 0 ? `${summary}（${detail}）` : summary);
    this.name = 'MarkdownDocumentContentError';
  }
}
