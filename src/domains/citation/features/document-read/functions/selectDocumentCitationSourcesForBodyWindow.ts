import type { DocumentCitationSource } from '../definitions/documentCitationProjection';

/**
 * 只选择 Citation-aware serializer 已经写入当前正文窗口的完整 canonical token。
 * 普通文本里的方括号会被 Markdown 转义，因此这里不会把用户手写的 `[@ref]` 当成已接纳引用。
 * 被分页边界切开的半个 token 不进入来源上下文，避免 metadata 与正文失配。
 */
export function selectDocumentCitationSourcesForBodyWindow(params: {
  readonly bodyWindow: string;
  readonly sources: readonly DocumentCitationSource[];
}): readonly DocumentCitationSource[] {
  return params.sources.filter(source => params.bodyWindow.includes(source.bodyToken));
}
