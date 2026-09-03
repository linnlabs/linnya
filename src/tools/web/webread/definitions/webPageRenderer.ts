export type WebPageRenderFailureKind =
  | 'unavailable'
  | 'aborted'
  | 'load_timeout'
  | 'render_timeout'
  | 'total_timeout'
  | 'navigation_blocked'
  | 'html_too_large'
  | 'render_process_gone'
  | 'render_failed';

export class WebPageRenderError extends Error {
  readonly name = 'WebPageRenderError';

  constructor(
    readonly kind: WebPageRenderFailureKind,
    message: string,
  ) {
    super(message);
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
}

export interface WebPageRenderer {
  render(params: WebPageRenderParams): Promise<WebPageRenderResult>;
}
