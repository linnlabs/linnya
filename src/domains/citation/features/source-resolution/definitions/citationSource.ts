/**
 * Agent 把 canonical `[@ref]` 写入文档前，来源 owner 必须提供的事实。
 *
 * 候选按可信优先级排列：同一 ref、同一来源锚点重复出现时保留第一条；
 * 同一 ref 指向不同锚点属于协议冲突，不能靠顺序覆盖。
 */
interface CitationSourceBase {
  readonly ref: string;
  readonly title: string;
  /** 引用发生时的来源快照；允许为空，读取时会显式报告 excerpt unavailable。 */
  readonly snippet: string;
}

export interface KnowledgeCitationSource
  extends CitationSourceBase {
  readonly sourceType: 'knowledge_base';
  readonly docId: string;
  readonly blockId: string;
  readonly kbId?: string;
}

export interface WebCitationSource extends CitationSourceBase {
  readonly sourceType: 'web';
  /** 必须是 HTTP(S) canonical URL；持久化时同时作为 sourceId 与 url。 */
  readonly url: string;
  readonly authors?: readonly string[];
  readonly publishedAt?: string;
  readonly containerTitle?: string;
}

export type CitationSource = KnowledgeCitationSource | WebCitationSource;

/**
 * 外部来源 owner 的窄端口。Citation domain 不读取 Knowledge、Web 或 Evidence 存储。
 */
export interface CitationSourceResolverPort {
  resolveSources(
    refs: readonly string[]
  ): Promise<readonly CitationSource[]>;
}
