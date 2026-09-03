import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createWebReadResult } from '../webread/functions/createWebReadResult';
import { createSearchResults } from '../websearch/functions/createSearchResults';

describe('Web M3 数据契约映射', () => {
  it('网页读取映射保留来源、最终地址、元数据和完整正文哈希', () => {
    const fullContent = '# Article\n\nComplete managed content';
    const result = createWebReadResult({
      url: 'https://example.com/start',
      finalUrl: 'https://example.com/final',
      status: 200,
      contentType: 'text/markdown',
      title: 'Article',
      content: fullContent,
      contentFormat: 'markdown',
      byline: 'Author',
      siteName: 'Example',
      publishedAt: '2026-07-18T00:00:00Z',
      language: 'en',
      rawHtmlRef: 'web-cache://raw/article-1',
      extractor: 'managed_reader',
      renderMode: 'managed',
      provider: 'fixture_reader',
      maxChars: 12,
      tokenCount: 42,
      rawLength: 1_024,
      fetchedAt: '2026-07-18T01:00:00Z',
      cacheAgeSeconds: 30,
      qualityScore: 0.9,
      warnings: ['content_too_short'],
      blockedReason: 'partial_login_wall',
      latencyMs: 321,
      estimatedCost: 0.001,
    });

    expect(result.url).toBe('https://example.com/start');
    expect(result.finalUrl).toBe('https://example.com/final');
    expect(result.content).toBe(fullContent.slice(0, 12));
    expect(result.markdown).toBe(result.content);
    expect(result.truncated).toBe(true);
    expect(result.contentHash).toBe(createHash('sha256').update(fullContent, 'utf8').digest('hex'));
    expect(result).toMatchObject({
      byline: 'Author',
      siteName: 'Example',
      extractor: 'managed_reader',
      renderMode: 'managed',
      provider: 'fixture_reader',
      tokenCount: 42,
      rawLength: 1_024,
      rawHtmlRef: 'web-cache://raw/article-1',
      cacheAgeSeconds: 30,
      qualityScore: 0.9,
      blockedReason: 'partial_login_wall',
      latencyMs: 321,
      estimatedCost: 0.001,
    });
  });

  it('搜索映射统一补齐 rank、canonical URL 与调用观测，不伪造未知评分', () => {
    const results = createSearchResults({
      query: 'web contract',
      provider: 'fixture_search',
      cached: false,
      latencyMs: 87,
      candidates: [
        {
          title: 'First',
          url: 'https://example.com/a?utm_source=test',
          snippet: 'first result',
          providerScore: 0.8,
          normalizedScore: 0.7,
        },
        { title: 'Second', url: 'https://example.com/b', snippet: 'second result' },
      ],
    });

    expect(results.map((result) => result.rank)).toEqual([1, 2]);
    expect(results[0]?.canonicalUrl).toBe('https://example.com/a');
    expect(results[0]).toMatchObject({
      query: 'web contract',
      provider: 'fixture_search',
      cached: false,
      latencyMs: 87,
      providerScore: 0.8,
      normalizedScore: 0.7,
    });
    expect(results[1]?.providerScore).toBeUndefined();
    expect(results[1]?.normalizedScore).toBeUndefined();
  });
});
