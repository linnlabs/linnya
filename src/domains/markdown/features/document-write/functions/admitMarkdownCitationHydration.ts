import {
  extractCanonicalCitationRefs,
  findInvalidMarkdownCitationTokens,
  type CitationSource,
} from '../../../../citation';
import type { CitationNodeHydrationData } from '../../normalization';

export type ResolveMarkdownCitationSources = (
  refs: readonly string[]
) => Promise<readonly CitationSource[]>;

/**
 * 把 Citation domain 已接纳的来源事实投影为 Markdown CitationNode hydration。
 *
 * Markdown 只依赖 Citation 的公开来源合同，不读取 ToolContext、Evidence 或 Web 内部状态。
 */
export async function admitMarkdownCitationHydration(
  markdown: string,
  resolveSources: ResolveMarkdownCitationSources
): Promise<Readonly<Record<string, CitationNodeHydrationData>>> {
  const invalidTokens = findInvalidMarkdownCitationTokens(markdown);
  if (invalidTokens.length > 0) {
    throw new Error(
      `引用格式不合法：${invalidTokens.map(token => JSON.stringify(token)).join(', ')}。`
    );
  }

  const refs = extractCanonicalCitationRefs(markdown);
  if (refs.length === 0) return {};

  const sources = await resolveSources(refs);
  const admitted = Object.fromEntries(sources.map(source => [source.ref, source]));

  return Object.fromEntries(
    refs.map(ref => {
      const source = admitted[ref];
      if (!source) {
        throw new Error(`Citation admission 内部缺少 [@${ref}]。`);
      }
      const hydration: CitationNodeHydrationData =
        source.sourceType === 'knowledge_base'
          ? {
              sourceType: source.sourceType,
              docId: source.docId,
              blockId: source.blockId,
              title: source.title,
              snippet: source.snippet,
              ...(source.kbId ? { kbId: source.kbId } : {}),
            }
          : {
              sourceType: source.sourceType,
              url: source.url,
              title: source.title,
              snippet: source.snippet,
              ...(source.authors ? { authors: [...source.authors] } : {}),
              ...(source.publishedAt ? { date: source.publishedAt } : {}),
              ...(source.containerTitle ? { containerTitle: source.containerTitle } : {}),
            };
      return [ref, hydration];
    })
  );
}
