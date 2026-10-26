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

export class WebPageRenderError extends Error {
  readonly name = 'WebPageRenderError';
  readonly mainResponse?: WebPageMainResponse;

  constructor(
    readonly kind: WebPageRenderFailureKind,
    message: string,
    options?: { readonly mainResponse?: WebPageMainResponse }
  ) {
    super(message);
    if (options?.mainResponse) this.mainResponse = options.mainResponse;
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
