import type { CitationSource } from './citationSource';

export interface DocumentCitationWriteScopeParams {
  /** 文档当前投影中的完整来源快照；ref 属于文档自身。 */
  readonly existingSources: readonly CitationSource[];
  /** 与 existingSources 逐项对齐的真实 Conversation allocator 别名。 */
  readonly conversationRefs: readonly string[];
  /** 基线中已持久化的完整来源；被 pending 隐藏后恢复时仍复用其身份、ref 与快照。 */
  readonly reservedSources: readonly CitationSource[];
  /** 基线与 pending 已占用的文档 ref，新来源不得占用。 */
  readonly reservedRefs: readonly string[];
}

/** 单次文档写入的局部映射，不读取或修改 Conversation claim。 */
export interface DocumentCitationWriteScope {
  resolveExistingAlias(ref: string): CitationSource | undefined;
  assignDocumentSource(source: CitationSource): CitationSource;
}
