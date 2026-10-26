import { WEB_ACQUIRED_FILE_MAX_BYTES } from '@app/schemas';
import {
  localHttpFetch,
  LOCAL_HTTP_MAX_BODY_BYTES,
  type LocalHttpFetchDependencies,
  type LocalHttpFetchOptions,
} from '../../../../infra/adapters/web-fetch/localHttpFetchAdapter';
import type { WebHttpResponse } from '../../../../infra/adapters/web-http/webHttpFetch';
import type { WebDocumentWarning } from '../../definitions/webDocument';
import { WebFailureError, getWebDiagnosticMimeType } from '../../shared/webFailure';
import { extractArticle } from '../extraction/extractArticle';
import { createWebReadResult } from '../functions/createWebReadResult';
import { resolveReadableWebUrl } from '../functions/resolveReadableWebUrl';
import type { WebReadParams, WebReadProvider, WebReadResult } from './types';
import { getWebFileFormat, validateWebFile } from '../file-acquisition/functions/validateWebFile';
import { WEB_FILE_FETCH_TIMEOUT_MS } from '../file-acquisition/definitions/webFileAcquisition';

const HTML_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const TEXT_APPLICATION_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/csv',
]);

export interface LocalHttpProviderDependencies extends LocalHttpFetchDependencies {
  fetchOptions?: Omit<LocalHttpFetchOptions, 'signal'>;
}

/** 2xx 且响应头声明正式文件类型；错误页和重定向不获得文件预算。 */
function isFileResponse(response: Pick<WebHttpResponse, 'status' | 'headers'>): boolean {
  return response.status >= 200 && response.status < 300
    && getWebFileFormat(response.headers.get('content-type') ?? '') !== undefined;
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
      // 在原 GET 的响应头处选择预算，不先失败再下载；重定向和错误页不扩大正文预算或时限。
      maxBodyBytes: response => isFileResponse(response)
        ? WEB_ACQUIRED_FILE_MAX_BYTES : LOCAL_HTTP_MAX_BODY_BYTES,
      extendTimeoutMs: response => isFileResponse(response) ? WEB_FILE_FETCH_TIMEOUT_MS : undefined,
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

    const filePayload = await validateWebFile({
      mimeType: fetched.mimeType,
      bytes: fetched.bodyData,
      decodedText: fetched.bodyText,
      finalUrl: fetched.finalUrl,
    });
    if (filePayload && filePayload.format !== 'csv') {
      return {
        ...createWebReadResult({
          url: params.url, finalUrl: fetched.finalUrl, status: fetched.status,
          contentType: fetched.contentType, title: titleFromUrl(fetched.finalUrl),
          content: '', contentFormat: 'text', extractor: 'file_download', renderMode: 'http',
          provider: this.name, rawLength: fetched.rawLength, latencyMs: fetched.tookMs,
        }),
        filePayload,
      };
    }

    if (HTML_MIME_TYPES.has(fetched.mimeType)) {
      const extracted = extractArticle(fetched.bodyText, { url: fetched.finalUrl });
      if (extracted.accessBarrier) {
        throw new WebFailureError(
          extracted.accessBarrier,
          extracted.accessBarrier === 'captcha'
            ? '本地网页返回了明确的人机验证页面。'
            : '本地网页要求登录后才能继续读取。',
          { status: fetched.status },
        );
      }
      if (!extracted.text && extracted.resources.length === 0) {
        throw new WebFailureError('empty_content', '本地网页正文抽取结果为空。', { status: fetched.status });
      }
      return createWebReadResult({
        url: params.url,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        contentType: fetched.contentType,
        title: extracted.title,
        content: extracted.text,
        contentFormat: 'markdown',
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
        resources: extracted.resources,
        latencyMs: fetched.tookMs,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      });
    }

    if (filePayload?.format === 'csv' || isDirectTextMime(fetched.mimeType)) {
      const content = fetched.bodyText.trim();
      if (!content) {
        throw new WebFailureError('empty_content', '本地网页文本响应为空。', { status: fetched.status });
      }
      const warnings: WebDocumentWarning[] = content.length < 200 ? ['content_too_short'] : [];
      return { ...createWebReadResult({
        url: params.url,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        contentType: fetched.contentType,
        title: titleFromUrl(fetched.finalUrl),
        content,
        contentFormat: fetched.mimeType === 'text/markdown' || fetched.mimeType === 'text/x-markdown'
          ? 'markdown' : 'text',
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
      }), ...(filePayload ? { filePayload } : {}) };
    }

    const diagnosticMimeType = getWebDiagnosticMimeType(fetched.mimeType);
    const unsupportedMessage = diagnosticMimeType
      ? `本地网页抓取暂不支持 MIME ${diagnosticMimeType}。`
      : '本地网页抓取收到不支持或无效的 Content-Type；未取得正文或保存文件。';
    throw new WebFailureError('unsupported_mime', unsupportedMessage, {
      status: fetched.status,
      details: { contentType: diagnosticMimeType, bodyBytes: fetched.rawLength },
    });
  }
}
