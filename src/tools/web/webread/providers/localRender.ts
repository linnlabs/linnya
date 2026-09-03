import {
  WebPageRenderError,
  type WebPageRenderer,
} from '../definitions/webPageRenderer';
import { WebFailureError } from '../../shared/webFailure';
import { extractArticle } from '../extraction/extractArticle';
import { createWebReadResult } from '../functions/createWebReadResult';
import { getWebPageRenderer } from '../ports/webPageRenderer';
import type { WebReadParams, WebReadProvider, WebReadResult } from './types';

const LOCAL_RENDER_TIMEOUT_MS = 30_000;

export interface LocalRenderProviderDependencies {
  readonly renderer?: WebPageRenderer;
  readonly timeoutMs?: number;
}

function mapRenderError(error: WebPageRenderError): WebFailureError {
  switch (error.kind) {
    case 'aborted':
      return new WebFailureError('aborted', error.message);
    case 'navigation_blocked':
      return new WebFailureError('policy_denied', error.message);
    case 'html_too_large':
      return new WebFailureError('body_too_large', error.message);
    case 'load_timeout':
    case 'render_timeout':
    case 'total_timeout':
      return new WebFailureError('timeout', error.message);
    case 'unavailable':
    case 'render_process_gone':
    case 'render_failed':
      return new WebFailureError('provider_error', error.message);
  }
}

export class LocalRenderProvider implements WebReadProvider {
  readonly name = 'local_render';

  constructor(private readonly dependencies: LocalRenderProviderDependencies = {}) {}

  async read(params: WebReadParams): Promise<WebReadResult> {
    const startedAt = Date.now();
    let rendered;
    try {
      rendered = await (this.dependencies.renderer ?? getWebPageRenderer()).render({
        url: params.url,
        signal: params.signal,
        timeoutMs: this.dependencies.timeoutMs ?? LOCAL_RENDER_TIMEOUT_MS,
      });
    } catch (error: unknown) {
      if (error instanceof WebPageRenderError) throw mapRenderError(error);
      throw error;
    }

    const extracted = extractArticle(rendered.html);
    if (extracted.accessBarrier) {
      throw new WebFailureError(
        extracted.accessBarrier,
        extracted.accessBarrier === 'captcha'
          ? '本地渲染后仍返回人机验证页面。'
          : '本地渲染后仍要求登录才能读取。',
      );
    }
    if (!extracted.text) {
      throw new WebFailureError('empty_content', '本地渲染后的网页正文抽取结果为空。');
    }

    return createWebReadResult({
      url: params.url,
      finalUrl: rendered.finalUrl,
      // Chromium port 当前只返回最终 DOM 和 URL；状态码不参与本地渲染质量决策。
      status: 200,
      contentType: 'text/html; charset=utf-8',
      title: extracted.title,
      content: extracted.text,
      contentFormat: 'text',
      byline: extracted.byline,
      siteName: extracted.siteName,
      publishedAt: extracted.publishedAt,
      language: extracted.language,
      extractor: extracted.extractor,
      renderMode: 'js',
      provider: this.name,
      maxChars: params.maxChars,
      rawLength: rendered.html.length,
      qualityScore: extracted.qualityScore,
      warnings: extracted.warnings,
      latencyMs: Date.now() - startedAt,
    });
  }
}
