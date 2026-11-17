import type { ToolContext } from './toolRuntime';

interface PluginCitationSourceBase {
  readonly ref: string;
  readonly title: string;
  readonly snippet: string;
}

export interface PluginKnowledgeCitationSource extends PluginCitationSourceBase {
  readonly sourceType: 'knowledge_base';
  readonly docId: string;
  readonly blockId: string;
  readonly kbId?: string;
}

export interface PluginWebCitationSource extends PluginCitationSourceBase {
  readonly sourceType: 'web';
  readonly url: string;
  readonly authors?: readonly string[];
  readonly publishedAt?: string;
  readonly containerTitle?: string;
}

export type PluginCitationSource =
  | PluginKnowledgeCitationSource
  | PluginWebCitationSource;

/** 插件只获取已由 Host 接纳的来源身份，不读取 history、bundle 或来源存储。 */
export interface PluginCitationSourceResolverPort {
  resolveSources(refs: readonly string[]): Promise<readonly PluginCitationSource[]>;
}

export declare function createCitationSourceResolver(
  context: ToolContext,
): PluginCitationSourceResolverPort;

export declare function normalizeCitationRef(ref: string): string | undefined;
export declare function isCanonicalCitationRef(ref: string): boolean;

/** 来源身份与 ref 规则由 Host 维持；插件不能获得 claim 存储或会话 salt。 */
export type PluginCitationSourceAnchor =
  | { readonly sourceType: 'knowledge_base'; readonly docId: string; readonly blockId: string }
  | { readonly sourceType: 'web'; readonly url: string };
export interface CitationRefAllocatorPort {
  allocate(anchors: readonly PluginCitationSourceAnchor[]): Promise<readonly string[]>;
}
export declare function requireCitationRefAllocator(context: ToolContext): CitationRefAllocatorPort;
export declare function requireCitationSequenceOffset(context: ToolContext): number;
export declare function createCitationSourceIdentity(anchor: PluginCitationSourceAnchor): string;

/** 本次实际展示给 Agent 的来源正文，不是 Evidence 持久化 DTO。 */
export interface PluginKnowledgeCitationEvidence {
  readonly ref: string;
  readonly title: string;
  readonly snippet: string;
  readonly contentText: string;
  readonly capturedAtMs: number;
  readonly captureKind: 'knowledge_search_result' | 'knowledge_document_preview' | 'knowledge_document_chunk';
  readonly documentId: string;
  readonly blockId: string;
  readonly documentName?: string;
}
/** scope 和 audit 只从冻结 ToolContext 接纳；不返回 bundle 身份或磁盘路径。 */
export declare function captureKnowledgeCitationEvidence(params: {
  readonly context: ToolContext;
  readonly query: string;
  readonly items: readonly PluginKnowledgeCitationEvidence[];
}): Promise<void>;
