import type { WebSearchProvider } from 'src/tools/web/websearch/providers/types';
import type { WebReadProvider } from 'src/tools/web/webread/providers/types';
import type { FrozenCorpus } from '../definitions/historicalCorpus';

/** 只检索冻结字节。零命中与未知链接均为真实缺口，没有 live fallback。 */
export function createHistoricalWebProviders(corpus: FrozenCorpus): {
  search: WebSearchProvider;
  read: WebReadProvider;
} {
  const byUrl = new Map(corpus.documents.map(source => [new URL(source.url).href, source]));
  return {
    search: {
      name: `historical_${corpus.corpusId}`,
      async search(params) {
        params.signal?.throwIfAborted();
        const tokens = [...new Set(params.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
        const ranked = corpus.documents
          .map(source => {
            const body = `${source.title}\n${source.text}`.toLowerCase();
            const hits = tokens.filter(token => body.includes(token));
            return {
              source,
              score: hits.length,
              position: hits.length ? body.indexOf(hits[0]) : 0,
            };
          })
          .filter(item => item.score > 0)
          .sort(
            (left, right) =>
              right.score - left.score || left.source.id.localeCompare(right.source.id)
          );
        return ranked.slice(0, params.topK ?? 10).map(({ source, position }, index) => ({
          query: params.query,
          provider: this.name,
          rank: index + 1,
          url: source.url,
          canonicalUrl: source.url,
          title: source.title,
          snippet: source.text.slice(
            Math.max(0, position - source.title.length - 1),
            position + 500
          ),
          publishedAt: source.availableAt,
          sourceType: 'official' as const,
          cached: false,
          latencyMs: 0,
        }));
      },
    },
    read: {
      name: `historical_${corpus.corpusId}`,
      async read(params) {
        params.signal?.throwIfAborted();
        const source = byUrl.get(new URL(params.url).href);
        if (!source)
          throw new Error(
            'HISTORICAL_SOURCE_UNAVAILABLE: URL is absent from the admitted corpus. No live request was made.'
          );
        return {
          url: source.url,
          finalUrl: source.url,
          status: 200,
          contentType: 'text/plain',
          title: source.title,
          content: source.text,
          text: source.text,
          charCount: source.text.length,
          rawLength: source.text.length,
          truncated: false,
          publishedAt: source.availableAt,
          // 取得时间仍为现在；历史公开时间不能伪装成工具执行时间。
          fetchedAt: new Date().toISOString(),
          contentHash: source.projectionSha256,
          extractor: 'frozen_publisher_projection',
          renderMode: 'http' as const,
          warnings: [],
          latencyMs: 0,
        };
      },
    },
  };
}
