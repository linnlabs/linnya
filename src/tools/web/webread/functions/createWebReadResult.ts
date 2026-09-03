import { createHash } from 'node:crypto';
import type { WebDocumentWarning, WebRenderMode } from '../../definitions/webDocument';
import type { WebReadResult } from '../providers/types';

export interface CreateWebReadResultInput {
  url: string;
  finalUrl?: string;
  status: number;
  contentType: string;
  title?: string;
  content: string;
  contentFormat: 'text' | 'markdown';
  byline?: string;
  siteName?: string;
  publishedAt?: string;
  language?: string;
  rawHtmlRef?: string;
  extractor: string;
  renderMode: WebRenderMode;
  provider?: string;
  maxChars?: number;
  tokenCount?: number;
  rawLength: number;
  fetchedAt?: string;
  etag?: string;
  lastModified?: string;
  cacheAgeSeconds?: number;
  qualityScore?: number;
  warnings?: WebDocumentWarning[];
  blockedReason?: string;
  latencyMs: number;
  estimatedCost?: number;
}

function resolveContentLimit(maxChars: number | undefined): number | undefined {
  return typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars > 0
    ? Math.floor(maxChars)
    : undefined;
}

export function createWebReadResult(input: CreateWebReadResultInput): WebReadResult {
  const limit = resolveContentLimit(input.maxChars);
  const truncated = limit !== undefined && input.content.length > limit;
  const content = truncated ? input.content.slice(0, limit) : input.content;
  const finalUrl = input.finalUrl ?? input.url;
  const contentHash = createHash('sha256').update(input.content, 'utf8').digest('hex');

  return {
    url: input.url,
    finalUrl,
    status: input.status,
    contentType: input.contentType,
    title: input.title ?? '',
    content,
    charCount: content.length,
    text: content,
    ...(input.contentFormat === 'markdown' ? { markdown: content } : {}),
    extractor: input.extractor,
    renderMode: input.renderMode,
    truncated,
    rawLength: input.rawLength,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    ...(input.etag ? { etag: input.etag } : {}),
    ...(input.lastModified ? { lastModified: input.lastModified } : {}),
    contentHash,
    warnings: input.warnings ?? [],
    latencyMs: input.latencyMs,
    ...(input.byline ? { byline: input.byline } : {}),
    ...(input.siteName ? { siteName: input.siteName } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.rawHtmlRef ? { rawHtmlRef: input.rawHtmlRef } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.tokenCount !== undefined ? { tokenCount: input.tokenCount } : {}),
    ...(input.cacheAgeSeconds !== undefined ? { cacheAgeSeconds: input.cacheAgeSeconds } : {}),
    ...(input.qualityScore !== undefined ? { qualityScore: input.qualityScore } : {}),
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
    ...(input.estimatedCost !== undefined ? { estimatedCost: input.estimatedCost } : {}),
  };
}
