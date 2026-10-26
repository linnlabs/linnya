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
  /** 主框架 DOMContentLoaded；不等待图片等子资源的 load 事件。 */
  onDomReady(listener: () => void): () => void;
}

/** 主框架响应头事实；头名已转小写，同名多值以 ", " 合并。 */
export interface WebPageRenderMainFrameResponse {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: WebResponseHeaderLookup;
}

export type WebPageRenderResponseDecision = 'continue' | 'cancel';

/** 页面子资源请求生命周期；id 在同一 session 内唯一。 */
export interface WebPageRenderSubresourceEvent {
  readonly id: number;
  /** data：xhr/fetch（Chromium 把 fetch 也归为 xhr）；script_or_style：脚本与样式表。 */
  readonly category: 'data' | 'script_or_style';
  readonly phase: 'started' | 'completed' | 'failed';
  /** Chromium 报告的 net 错误名，只在 failed 时出现；消费方仍须校验形状。 */
  readonly error?: string;
}

export interface WebPageRenderSession {
  clearStorageData(): Promise<void>;
  installSecurityGuards(): () => void;
  /** 在响应正文交给页面前观察主框架响应头；返回 cancel 时取消该响应。 */
  observeMainFrameResponses(
    listener: (response: WebPageRenderMainFrameResponse) => WebPageRenderResponseDecision,
  ): () => void;
  /** 只观察数据请求与脚本/样式表的发出、完成和失败，不拦截也不读取请求内容。 */
  observeSubresources(listener: (event: WebPageRenderSubresourceEvent) => void): () => void;
}

export interface WebPageRenderRuntime {
  createWindow(options: WebPageRenderWindowOptions): WebPageRenderWindow;
  createSession(partition: string): WebPageRenderSession;
}
