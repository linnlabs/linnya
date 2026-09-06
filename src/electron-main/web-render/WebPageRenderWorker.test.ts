import { describe, expect, it, vi } from 'vitest';
import type {
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderWindow,
  WebPageRenderWindowOptions,
} from './definitions/webPageRenderRuntime';
import { WebPageRenderWorker } from './WebPageRenderWorker';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

class FakeRenderSession implements WebPageRenderSession {
  clearCount = 0;
  guardsInstalled = 0;
  guardsRemoved = 0;

  async clearStorageData(): Promise<void> {
    this.clearCount += 1;
  }

  installSecurityGuards(): () => void {
    this.guardsInstalled += 1;
    return () => {
      this.guardsRemoved += 1;
    };
  }
}

class FakeRenderWindow implements WebPageRenderWindow {
  url = '';
  destroyed = false;
  destroyCount = 0;
  html: unknown = '<html><body>rendered article</body></html>';
  loadURLImpl: (url: string) => Promise<void> = async (url) => {
    this.url = url;
  };
  executeImpl: () => Promise<unknown> = async () => this.html;
  private isAllowed: ((url: string) => boolean) | undefined;
  private onBlocked: ((url: string) => void) | undefined;
  private closedListener: (() => void) | undefined;
  private goneListener: ((reason: string) => void) | undefined;
  private unresponsiveListener: (() => void) | undefined;

  loadURL(url: string): Promise<void> {
    return this.loadURLImpl(url);
  }

  executeJavaScript(): Promise<unknown> {
    return this.executeImpl();
  }

  getURL(): string {
    return this.url;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.destroyCount += 1;
  }

  installNavigationGuards(
    isAllowed: (url: string) => boolean,
    onBlocked: (url: string) => void,
  ): () => void {
    this.isAllowed = isAllowed;
    this.onBlocked = onBlocked;
    return () => {
      this.isAllowed = undefined;
      this.onBlocked = undefined;
    };
  }

  onClosed(listener: () => void): () => void {
    this.closedListener = listener;
    return () => {
      this.closedListener = undefined;
    };
  }

  onRenderProcessGone(listener: (reason: string) => void): () => void {
    this.goneListener = listener;
    return () => {
      this.goneListener = undefined;
    };
  }

  onUnresponsive(listener: () => void): () => void {
    this.unresponsiveListener = listener;
    return () => {
      this.unresponsiveListener = undefined;
    };
  }

  attemptNavigation(url: string): void {
    if (!this.isAllowed?.(url)) this.onBlocked?.(url);
  }
}

class FakeRenderRuntime implements WebPageRenderRuntime {
  readonly session = new FakeRenderSession();
  readonly windows: FakeRenderWindow[] = [];
  readonly partitions: string[] = [];
  nextWindow: FakeRenderWindow | undefined;

  createWindow(options: WebPageRenderWindowOptions): WebPageRenderWindow {
    this.partitions.push(options.partition);
    const renderWindow = this.nextWindow ?? new FakeRenderWindow();
    this.nextWindow = undefined;
    this.windows.push(renderWindow);
    return renderWindow;
  }

  createSession(partition: string): WebPageRenderSession {
    this.partitions.push(partition);
    return this.session;
  }
}

function createWorker(
  runtime: FakeRenderRuntime,
  overrides: Partial<ConstructorParameters<typeof WebPageRenderWorker>[0]> = {},
): WebPageRenderWorker {
  return new WebPageRenderWorker({
    runtime,
    partition: 'web-render:test',
    settleDelayMs: 0,
    loadTimeoutMs: 50,
    renderTimeoutMs: 50,
    totalTimeoutMs: 100,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  });
}

describe('WebPageRenderWorker', () => {
  it('在独立 session 中加载页面并提取渲染后的 DOM', async () => {
    const runtime = new FakeRenderRuntime();
    const worker = createWorker(runtime);

    const result = await worker.render({ url: 'https://example.com/app' });

    expect(result).toEqual({
      html: '<html><body>rendered article</body></html>',
      finalUrl: 'https://example.com/app',
    });
    expect(runtime.session.clearCount).toBe(1);
    expect(runtime.session.guardsInstalled).toBe(1);
    expect(new Set(runtime.partitions)).toEqual(new Set(['web-render:test']));
    expect(runtime.windows[0]?.destroyCount).toBe(1);
    await worker.dispose();
    expect(runtime.session.guardsRemoved).toBe(1);
  });

  it('拒绝页面导航到第三方 hostname，并强制销毁窗口', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      renderWindow.attemptNavigation('https://attacker.example/escape');
      await new Promise<void>(() => undefined);
    };
    runtime.nextWindow = renderWindow;

    await expect(createWorker(runtime).render({ url: 'https://example.com/app' })).rejects.toEqual(
      expect.objectContaining({ kind: 'navigation_blocked' }),
    );
    expect(renderWindow.destroyCount).toBe(1);
  });

  it('调用方取消时立即终止加载并销毁窗口', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    const loading = deferred<void>();
    renderWindow.loadURLImpl = () => loading.promise;
    runtime.nextWindow = renderWindow;
    const controller = new AbortController();
    const rendering = createWorker(runtime).render({
      url: 'https://example.com/app',
      signal: controller.signal,
    });

    controller.abort();
    await expect(rendering).rejects.toEqual(expect.objectContaining({ kind: 'aborted' }));
    expect(renderWindow.destroyCount).toBe(1);
  });

  it('加载、DOM 提取和总墙钟超时分别返回稳定失败并销毁窗口', async () => {
    const loadRuntime = new FakeRenderRuntime();
    const loadWindow = new FakeRenderWindow();
    loadWindow.loadURLImpl = async () => await new Promise<void>(() => undefined);
    loadRuntime.nextWindow = loadWindow;
    await expect(createWorker(loadRuntime, { loadTimeoutMs: 5 }).render({
      url: 'https://example.com/load',
    })).rejects.toEqual(expect.objectContaining({ kind: 'load_timeout' }));
    expect(loadWindow.destroyCount).toBe(1);

    const renderRuntime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.executeImpl = async () => await new Promise<unknown>(() => undefined);
    renderRuntime.nextWindow = renderWindow;
    await expect(createWorker(renderRuntime, { renderTimeoutMs: 5 }).render({
      url: 'https://example.com/render',
    })).rejects.toEqual(expect.objectContaining({ kind: 'render_timeout' }));
    expect(renderWindow.destroyCount).toBe(1);

    const totalRuntime = new FakeRenderRuntime();
    const totalWindow = new FakeRenderWindow();
    totalWindow.loadURLImpl = async () => await new Promise<void>(() => undefined);
    totalRuntime.nextWindow = totalWindow;
    await expect(createWorker(totalRuntime, { loadTimeoutMs: 100 }).render({
      url: 'https://example.com/total',
      timeoutMs: 5,
    })).rejects.toEqual(expect.objectContaining({ kind: 'total_timeout' }));
    expect(totalWindow.destroyCount).toBe(1);
  });

  it('渲染 DOM 超过字节预算时失败，不把巨型 HTML 送入 backend', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.html = '<html>too large</html>';
    runtime.nextWindow = renderWindow;

    await expect(createWorker(runtime, { maxHtmlBytes: 8 }).render({
      url: 'https://example.com/large',
    })).rejects.toEqual(expect.objectContaining({ kind: 'html_too_large' }));
    expect(renderWindow.destroyCount).toBe(1);
  });

  it('页面状态稳定后才提取 DOM，且保留动态页面的有限等待窗口', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    const responses: unknown[] = [
      { readyState: 'loading', textLength: 0, htmlLength: 80 },
      { readyState: 'complete', textLength: 100, htmlLength: 200 },
      { readyState: 'complete', textLength: 100, htmlLength: 200 },
      { readyState: 'complete', textLength: 100, htmlLength: 200 },
      '<html><body>stable article</body></html>',
    ];
    renderWindow.executeImpl = async () => responses.shift();
    runtime.nextWindow = renderWindow;

    const result = await createWorker(runtime, {
      settleDelayMs: 0,
      maxSettleDelayMs: 1_000,
      renderTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
    }).render({ url: 'https://example.com/dynamic' });

    expect(result.html).toContain('stable article');
    expect(responses).toHaveLength(0);
  });
});
