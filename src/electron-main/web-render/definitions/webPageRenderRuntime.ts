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

export interface WebPageRenderSession {
  clearStorageData(): Promise<void>;
  installSecurityGuards(): () => void;
}

export interface WebPageRenderRuntime {
  createWindow(options: WebPageRenderWindowOptions): WebPageRenderWindow;
  createSession(partition: string): WebPageRenderSession;
}
