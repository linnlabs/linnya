import {
  WebPageRenderError,
  type WebPageMainResponse,
  type WebPageRenderer,
} from '../definitions/webPageRenderer';
import { WebFailureError, type WebFailureKind } from '../../shared/webFailure';
import {
  createWebAccessChallengeHeaderLookup,
  detectWebAccessChallengeHeader,
} from '../../shared/webAccessChallenge';
import { extractArticle } from '../extraction/extractArticle';
import { createWebReadResult } from '../functions/createWebReadResult';
import { getWebPageRenderer } from '../ports/webPageRenderer';
import type { WebReadParams, WebReadProvider, WebReadResult } from './types';

const LOCAL_RENDER_TIMEOUT_MS = 30_000;

export interface LocalRenderProviderDependencies {
  readonly renderer?: WebPageRenderer;
  readonly timeoutMs?: number;
}

/** 主响应是否为挑战由 Web 规则最终判定；渲染端停止页面只是安全动作，不作为分类来源。 */
function createRenderAccessChallengeError(mainResponse: WebPageMainResponse | undefined): WebFailureError {
  const challengeSignal = mainResponse
    ? detectWebAccessChallengeHeader(createWebAccessChallengeHeaderLookup(mainResponse.headers))
    : undefined;
  const status = mainResponse?.status;
  return new WebFailureError('captcha', '本地网页渲染遇到站点访问验证，已在页面执行前停止。', {
    ...(status !== undefined ? { status } : {}),
    details: {
      failureStage: 'local_render',
      renderFailureKind: 'access_challenge',
      ...(status !== undefined ? { status } : {}),
      ...(challengeSignal ? { challengeSignal } : {}),
    },
  });
}

/**
 * Chromium net 错误码分组：-20 是本地 URL/DNS 准入拦截；≤ -100 覆盖连接、TLS、证书、HTTP 协议与 DNS
 * 失败，属于站点或网络路径问题；其余（如 -3 导航中止）仍按渲染能力失败处理，不猜成网络问题。
 */
function mapLoadFailure(netErrorCode: number | undefined): { kind: WebFailureKind; message: string } {
  if (netErrorCode === -20) return { kind: 'policy_denied', message: '本地网页渲染的请求被访问策略拒绝。' };
  if (netErrorCode !== undefined && netErrorCode <= -100) {
    return { kind: 'network_error', message: '本地渲染加载网页时网络或 TLS 连接失败。' };
  }
  return { kind: 'provider_error', message: '本地网页渲染加载页面失败。' };
}

function mapRenderError(error: WebPageRenderError): WebFailureError {
  const options = {
    details: {
      failureStage: 'local_render' as const,
      renderFailureKind: error.kind,
      ...(error.netErrorCode !== undefined ? { netErrorCode: error.netErrorCode } : {}),
      ...(error.subresourceFailures
        ? {
            subresourceFailureCount: error.subresourceFailures.count,
            ...(error.subresourceFailures.sampleError
              ? { subresourceError: error.subresourceFailures.sampleError } : {}),
          }
        : {}),
    },
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
    case 'access_challenge':
      return createRenderAccessChallengeError(error.mainResponse);
    case 'app_shell_not_rendered':
      return new WebFailureError('js_required', '本地渲染已执行页面脚本，但前端应用在时限内未渲染出正文。', options);
    case 'load_failed': {
      const mapped = mapLoadFailure(error.netErrorCode);
      return new WebFailureError(mapped.kind, mapped.message, options);
    }
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

    if (detectWebAccessChallengeHeader(
      createWebAccessChallengeHeaderLookup(rendered.mainResponse.headers),
    )) {
      throw createRenderAccessChallengeError(rendered.mainResponse);
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
      // 状态码来自主框架实际响应，只作结果事实，不参与本地渲染质量决策。
      status: rendered.mainResponse.status,
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
