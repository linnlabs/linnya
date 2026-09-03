import {
  localHttpFetch,
  type LocalHttpFetchDependencies,
  type LocalHttpFetchOptions,
} from '../../../../infra/adapters/web-fetch/localHttpFetchAdapter';
import type { WebDocumentWarning } from '../../definitions/webDocument';
import { WebFailureError } from '../../shared/webFailure';
import { extractArticle } from '../extraction/extractArticle';
import { createWebReadResult } from '../functions/createWebReadResult';
import { resolveReadableWebUrl } from '../functions/resolveReadableWebUrl';
import type { WebReadParams, WebReadProvider, WebReadResult } from './types';

const HTML_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const TEXT_APPLICATION_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
]);

export interface LocalHttpProviderDependencies extends LocalHttpFetchDependencies {
  fetchOptions?: Omit<LocalHttpFetchOptions, 'signal'>;
}

function isDirectTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || TEXT_APPLICATION_MIME_TYPES.has(mimeType);
}

function titleFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  return url.pathname === '/' ? url.hostname : `${url.hostname}${url.pathname}`;
}

export class LocalHttpProvider implements WebReadProvider {
  readonly name = 'local_http';

  constructor(private readonly dependencies: LocalHttpProviderDependencies = {}) {}

  async read(params: WebReadParams): Promise<WebReadResult> {
    const requestUrl = resolveReadableWebUrl(params.url);
    const fetched = await localHttpFetch(requestUrl, {
      ...this.dependencies.fetchOptions,
      signal: params.signal,
      ...(params.revalidation
        ? {
            validators: {
              ...(params.revalidation.etag ? { etag: params.revalidation.etag } : {}),
              ...(params.revalidation.lastModified
                ? { lastModified: params.revalidation.lastModified }
                : {}),
            },
          }
        : {}),
    }, this.dependencies);

    if (fetched.notModified) {
      const cachedResult = params.revalidation?.cachedResult;
      if (!cachedResult) {
        throw new WebFailureError('invalid_response', '网页返回 304，但本地没有可复用的过期正文。', {
          status: fetched.status,
        });
      }
      return {
        ...cachedResult,
        url: params.url,
        finalUrl: fetched.finalUrl,
        fetchedAt: new Date().toISOString(),
        cacheAgeSeconds: 0,
        latencyMs: fetched.tookMs,
        ...(fetched.etag ? { etag: fetched.etag } : {}),
        ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
      };
    }

    if (HTML_MIME_TYPES.has(fetched.mimeType)) {
      const extracted = extractArticle(fetched.bodyText);
      if (extracted.accessBarrier) {
        throw new WebFailureError(
          extracted.accessBarrier,
          extracted.accessBarrier === 'captcha'
            ? '本地网页返回了明确的人机验证页面。'
            : '本地网页要求登录后才能继续读取。',
          { status: fetched.status },
        );
      }
      if (!extracted.text) {
        throw new WebFailureError('empty_content', '本地网页正文抽取结果为空。', { status: fetched.status });
      }
      return createWebReadResult({
        url: params.url,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        contentType: fetched.contentType,
        title: extracted.title,
        content: extracted.text,
        contentFormat: 'text',
        byline: extracted.byline,
        siteName: extracted.siteName,
        publishedAt: extracted.publishedAt,
        language: extracted.language,
        extractor: extracted.extractor,
        renderMode: 'http',
        provider: this.name,
        maxChars: params.maxChars,
        rawLength: fetched.rawLength,
        qualityScore: extracted.qualityScore,
        warnings: extracted.warnings,
        latencyMs: fetched.tookMs,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      });
    }

    if (isDirectTextMime(fetched.mimeType)) {
      const content = fetched.bodyText.trim();
      if (!content) {
        throw new WebFailureError('empty_content', '本地网页文本响应为空。', { status: fetched.status });
      }
      const warnings: WebDocumentWarning[] = content.length < 200 ? ['content_too_short'] : [];
      return createWebReadResult({
        url: params.url,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        contentType: fetched.contentType,
        title: titleFromUrl(fetched.finalUrl),
        content,
        contentFormat: 'text',
        extractor: 'raw_text',
        renderMode: 'http',
        provider: this.name,
        maxChars: params.maxChars,
        rawLength: fetched.rawLength,
        qualityScore: content.length >= 200 ? 1 : 0.5,
        warnings,
        latencyMs: fetched.tookMs,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      });
    }

    const unsupportedMessage = fetched.mimeType === 'application/pdf'
      ? 'WebRead 暂不支持 PDF，请改用对应的 HTML 页面或其他文本来源。'
      : `本地网页抓取暂不支持 MIME ${fetched.mimeType}。`;
    throw new WebFailureError('unsupported_mime', unsupportedMessage, { status: fetched.status });
  }
}
