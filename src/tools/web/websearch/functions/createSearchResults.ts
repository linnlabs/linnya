import type { SearchResult, WebSearchSourceType } from '../../definitions/searchResult';
import { normalizeUrl } from '../citations/normalizeUrl';

export interface SearchResultCandidate {
  url: string;
  title: string;
  snippet: string;
  siteName?: string;
  publishedAt?: string;
  language?: string;
  sourceType?: WebSearchSourceType;
  providerScore?: number;
  normalizedScore?: number;
}

export function createSearchResults(args: {
  query: string;
  provider: string;
  cached: boolean;
  latencyMs: number;
  candidates: SearchResultCandidate[];
}): SearchResult[] {
  return args.candidates.map((candidate, index) => ({
    query: args.query,
    provider: args.provider,
    rank: index + 1,
    url: candidate.url,
    canonicalUrl: normalizeUrl(candidate.url),
    title: candidate.title,
    snippet: candidate.snippet,
    cached: args.cached,
    latencyMs: args.latencyMs,
    ...(candidate.siteName ? { siteName: candidate.siteName } : {}),
    ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
    ...(candidate.language ? { language: candidate.language } : {}),
    ...(candidate.sourceType ? { sourceType: candidate.sourceType } : {}),
    ...(candidate.providerScore !== undefined ? { providerScore: candidate.providerScore } : {}),
    ...(candidate.normalizedScore !== undefined ? { normalizedScore: candidate.normalizedScore } : {}),
  }));
}
