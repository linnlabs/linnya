import { WebPageRenderError, type WebPageRenderer } from '../definitions/webPageRenderer';
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
  const options = {
    details: { failureStage: 'local_render' as const, renderFailureKind: error.kind },
  };
  // Chromium 的错误文字可能含页面地址或页面脚本异常，只公开稳定 kind，不转述任意 message。
  switch (error.kind) {
    case 'aborted':
      return new WebFailureError('aborted', '本地网页渲染已取消。', options);
    case 'navigation_blocked':
      return new WebFailureError('policy_denied', '本地网页渲染被导航策略拒绝。', options);
    case 'html_too_large':
      return new WebFailureError('body_too_large', '本地网页渲染内容超过上限。', options);
    case 'load_timeout':
    case 'render_timeout':
    case 'total_timeout':
      return new WebFailureError('timeout', '本地网页渲染超时。', options);
    case 'unavailable':
    case 'render_process_gone':
    case 'render_failed':
      return new WebFailureError('provider_error', '本地网页渲染能力失败。', options);
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

    const extracted = extractArticle(rendered.html, { url: rendered.finalUrl });
    if (extracted.accessBarrier) {
      throw new WebFailureError(
        extracted.accessBarrier,
        extracted.accessBarrier === 'captcha'
          ? '本地渲染后仍返回人机验证页面。'
          : '本地渲染后仍要求登录才能读取。'
      );
    }
    if (!extracted.text && extracted.resources.length === 0) {
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
      contentFormat: 'markdown',
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
      resources: extracted.resources,
      latencyMs: Date.now() - startedAt,
    });
  }
}
