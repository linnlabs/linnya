import type { WebResponseHeaderLookup } from '../../../tools/web/shared/webAccessChallenge';

export interface WebPageRenderWindowOptions {
  readonly partition: string;
}

export interface WebPageRenderWindow {
  loadURL(url: string): Promise<void>;
  executeJavaScript(script: string): Promise<unknown>;
  getURL(): string;
  isDestroyed(): boolean;
  destroy(): void;
  installNavigationGuards(
    isAllowed: (url: string) => boolean,
    onBlocked: (url: string) => void,
  ): () => void;
  onClosed(listener: () => void): () => void;
  onRenderProcessGone(listener: (reason: string) => void): () => void;
  onUnresponsive(listener: () => void): () => void;
}

/** 主框架响应头事实；头名已转小写，同名多值以 ", " 合并。 */
export interface WebPageRenderMainFrameResponse {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: WebResponseHeaderLookup;
}

export type WebPageRenderResponseDecision = 'continue' | 'cancel';

export interface WebPageRenderSession {
  clearStorageData(): Promise<void>;
  installSecurityGuards(): () => void;
  /** 在响应正文交给页面前观察主框架响应头；返回 cancel 时取消该响应。 */
  observeMainFrameResponses(
    listener: (response: WebPageRenderMainFrameResponse) => WebPageRenderResponseDecision,
  ): () => void;
}

export interface WebPageRenderRuntime {
  createWindow(options: WebPageRenderWindowOptions): WebPageRenderWindow;
  createSession(partition: string): WebPageRenderSession;
}
