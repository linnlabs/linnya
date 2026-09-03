import { readToolContextWorkingHistory } from '@linnlabs/linnkit/runtime-kernel';
import type {
  PluginCitationSource,
  PluginCitationSourceResolverPort,
} from '@linnya/plugin-host-contract/backend/citationSourceRuntime';
import type { ToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import {
  normalizeCitationRef,
  type CitationSource,
} from '../../domains/citation';
import { resolveEvidenceFromBundles } from '../../domains/evidence';
import {
  requireToolConversationScope,
} from '../../app-hosts/linnya/adapters/tools/conversation-scope';
import {
  createCitationSourceResolver as createHostCitationSourceResolver,
} from '../../app-hosts/linnya/adapters/tools/citation-source-resolution/orchestration/createCitationSourceResolver';

export type {
  PluginCitationSource,
  PluginCitationSourceResolverPort,
  PluginKnowledgeCitationSource,
  PluginWebCitationSource,
} from '@linnya/plugin-host-contract/backend/citationSourceRuntime';

function projectPluginCitationSource(source: CitationSource): PluginCitationSource {
  return source.sourceType === 'knowledge_base'
    ? {
        sourceType: source.sourceType,
        ref: source.ref,
        docId: source.docId,
        blockId: source.blockId,
        title: source.title,
        snippet: source.snippet,
        ...(source.kbId ? { kbId: source.kbId } : {}),
      }
    : {
        sourceType: source.sourceType,
        ref: source.ref,
        url: source.url,
        title: source.title,
        snippet: source.snippet,
        ...(source.authors ? { authors: source.authors } : {}),
        ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
        ...(source.containerTitle ? { containerTitle: source.containerTitle } : {}),
      };
}

/**
 * 为一次插件工具执行创建 Citation 来源解析端口。
 * 端口只投影已接纳来源；working history、EvidenceStore 与 conversation scope 均留在 Host。
 */
export function createCitationSourceResolver(
  context: ToolContext,
): PluginCitationSourceResolverPort {
  const resolver = createHostCitationSourceResolver({
    events: readToolContextWorkingHistory(context),
    async resolveEvidence(refs) {
      const { conversationId, instanceId } = requireToolConversationScope({
        context,
        errorPrefix: '[PluginCitationSourceResolver]',
      });
      return resolveEvidenceFromBundles({
        conversationId,
        instanceId,
        scope: 'conversation',
        refs: [...refs],
        max_units: 500,
        max_chars: 500,
      });
    },
  });

  return {
    async resolveSources(refs) {
      const sources = await resolver.resolveSources(refs);
      return sources.map(projectPluginCitationSource);
    },
  };
}

export { normalizeCitationRef };
