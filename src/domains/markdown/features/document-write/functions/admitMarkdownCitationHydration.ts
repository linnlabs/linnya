import {
  extractCanonicalCitationRefs,
  findInvalidMarkdownCitationTokens,
  normalizeCitationWebUrl,
  type CitationSource,
  type WebCitationSource,
} from '../../../../citation';
import type {
  CitationLinkHydrationData,
  CitationNodeHydrationData,
} from '../../normalization';

export type ResolveMarkdownCitationSources = (
  refs: readonly string[]
) => Promise<readonly CitationSource[]>;

export type ResolveMarkdownCitationSourcesByUrl = (
  urls: readonly string[]
) => Promise<readonly WebCitationSource[]>;

export function toCitationNodeHydrationData(
  source: CitationSource
): CitationNodeHydrationData {
  return source.sourceType === 'knowledge_base'
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
}

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
      return [ref, toCitationNodeHydrationData(source)];
    })
  );
}

/**
 * 把标准 Markdown 链接接纳为 CitationNode 的来源 hydration。
 * 未命中的 URL 不进入结果，调用方可以继续将其作为普通超链接保存。
 */
export async function admitMarkdownCitationLinkHydration(
  urls: readonly string[],
  resolveSourcesByUrl: ResolveMarkdownCitationSourcesByUrl,
): Promise<Readonly<Record<string, CitationLinkHydrationData>>> {
  const normalizedUrls = Array.from(new Set(urls.map(normalizeCitationWebUrl)));
  if (normalizedUrls.length === 0) return {};

  const sources = await resolveSourcesByUrl(normalizedUrls);
  const result: Record<string, CitationLinkHydrationData> = {};
  for (const source of sources) {
    const key = normalizeCitationWebUrl(source.url);
    const existing = result[key];
    if (existing && existing.ref !== source.ref) {
      throw new Error(`Web citation URL ${key} 对应了不同的 ref。`);
    }
    result[key] = {
      ref: source.ref,
      data: toCitationNodeHydrationData(source),
    };
  }
  return result;
}
