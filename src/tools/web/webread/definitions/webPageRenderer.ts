import type { WebRenderFailureKind } from '@app/schemas';
import type { WebAccessChallengeHeaderName } from '../../shared/webAccessChallenge';

export type WebPageRenderFailureKind = WebRenderFailureKind;

/** 回传的主响应头只限访问挑战判定所需名字；值由渲染端裁剪，不是完整响应头。 */
export const WEB_PAGE_MAIN_RESPONSE_HEADER_MAX_CHARS = 256;

/** 主框架最近一次 HTTP 响应的事实；状态码不由 DOM 文字推断。 */
export interface WebPageMainResponse {
  readonly status: number;
  readonly headers: Readonly<Partial<Record<WebAccessChallengeHeaderName, string>>>;
}

/** Chromium net 错误名的合法形状；只接纳这种 token，任意错误文字不跨进程传递。 */
export const WEB_PAGE_NET_ERROR_NAME_PATTERN = /^net::ERR_[A-Z0-9_]{1,64}$/;

/** 本次渲染中一类子资源的传输失败；只计数并保留首个合法错误名，不记录地址或内容。 */
export interface WebPageSubresourceFailures {
  readonly count: number;
  readonly sampleError?: string;
}

export class WebPageRenderError extends Error {
  readonly name = 'WebPageRenderError';
  readonly mainResponse?: WebPageMainResponse;
  /** 主框架加载失败时 Chromium 的数值 net 错误码（如 -107）。 */
  readonly netErrorCode?: number;
  /** 脚本与样式表下载失败；与数据请求分开，不能把请求用途或因果关系当作已知事实。 */
  readonly subresourceFailures?: WebPageSubresourceFailures;
  readonly dataRequestFailures?: WebPageSubresourceFailures;

  constructor(
    readonly kind: WebPageRenderFailureKind,
    message: string,
    options?: {
      readonly mainResponse?: WebPageMainResponse;
      readonly netErrorCode?: number;
      readonly subresourceFailures?: WebPageSubresourceFailures;
      readonly dataRequestFailures?: WebPageSubresourceFailures;
    }
  ) {
    super(message);
    if (options?.mainResponse) this.mainResponse = options.mainResponse;
    if (options?.netErrorCode !== undefined) this.netErrorCode = options.netErrorCode;
    if (options?.subresourceFailures) this.subresourceFailures = options.subresourceFailures;
    if (options?.dataRequestFailures) this.dataRequestFailures = options.dataRequestFailures;
  }
}

export interface WebPageRenderParams {
  readonly url: string;
  readonly signal?: AbortSignal;
  /** 整个渲染任务的墙钟上限；阶段上限仍由主进程 worker 控制。 */
  readonly timeoutMs?: number;
}

export interface WebPageRenderResult {
  readonly html: string;
  readonly finalUrl: string;
  readonly mainResponse: WebPageMainResponse;
}

export interface WebPageRenderer {
  render(params: WebPageRenderParams): Promise<WebPageRenderResult>;
}
