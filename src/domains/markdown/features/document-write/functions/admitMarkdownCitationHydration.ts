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
  markdown: string | readonly string[],
  resolveSources: ResolveMarkdownCitationSources
): Promise<Readonly<Record<string, CitationNodeHydrationData>>> {
  // pending 的接纳和 metadata 分配必须使用同一批 canonical blocks；不能先全文配对
  // 反引号，再按单块取 ref。创建入口仍可传一份完整 Markdown。
  const blocks = typeof markdown === 'string' ? [markdown] : markdown;
  const invalidTokens = [...new Set(blocks.flatMap(findInvalidMarkdownCitationTokens))];
  if (invalidTokens.length > 0) {
    // 结果序号、来源简称和 untrusted-content 边界 ID 都不是来源身份；仅列错字会诱发反复猜 ref。
    // 不提供虚构的六位示例，也不把合法外观当成已取得来源，由原 resolver 继续验证绑定。
    throw new Error(
      `Invalid citation tokens: ${invalidTokens.map(token => JSON.stringify(token)).join(', ')}. ` +
      'Copy the exact [@ref] token returned for that source by a tool or read_file Citation Sources; ' +
      'ref is the six-character source ID, not a Result number, source name, or content-boundary ID. ' +
      'Keep each source in its own [@ref] token. Put page or table locators outside the token: ' +
      '[@ref] (p. 5), not [@ref, p. 5]. When discussing citation syntax rather than citing a source, ' +
      'wrap the example in inline code. If the token is unavailable, read the source again; ' +
      'do not invent, shorten, or pad a ref. This write was not applied.'
    );
  }

  const refs = [...new Set(blocks.flatMap(extractCanonicalCitationRefs))];
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
  const requested = new Set(normalizedUrls);
  const result: Record<string, CitationLinkHydrationData> = {};
  for (const source of sources) {
    const key = normalizeCitationWebUrl(source.url);
    if (!requested.has(key)) {
      throw new Error(`Citation URL resolver 返回了未请求的来源 ${key}。`);
    }
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
