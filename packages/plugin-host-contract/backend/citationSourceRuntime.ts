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
