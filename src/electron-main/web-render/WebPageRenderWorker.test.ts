import { describe, expect, it, vi } from 'vitest';
import type {
  WebPageRenderMainFrameResponse,
  WebPageRenderResponseDecision,
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderSubresourceEvent,
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

  private responseObserver:
    | ((response: WebPageRenderMainFrameResponse) => WebPageRenderResponseDecision)
    | undefined;

  observeMainFrameResponses(
    listener: (response: WebPageRenderMainFrameResponse) => WebPageRenderResponseDecision,
  ): () => void {
    this.responseObserver = listener;
    return () => {
      this.responseObserver = undefined;
    };
  }

  private subresourceObserver: ((event: WebPageRenderSubresourceEvent) => void) | undefined;

  observeSubresources(listener: (event: WebPageRenderSubresourceEvent) => void): () => void {
    this.subresourceObserver = listener;
    return () => {
      this.subresourceObserver = undefined;
    };
  }

  dataRequest(id: number, phase: 'started' | 'completed' | 'failed', error?: string): void {
    this.subresourceObserver?.({ id, category: 'data', phase, ...(error ? { error } : {}) });
  }

  scriptFailed(id: number, error: string): void {
    this.subresourceObserver?.({ id, category: 'script_or_style', phase: 'failed', error });
  }

  /** 模拟 Electron 在正文交给页面前回调主框架响应头；未安装观察者时视为拒绝。 */
  respond(url: string, statusCode = 200, headers: Record<string, string> = {}): WebPageRenderResponseDecision {
    const lookup = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    return this.responseObserver?.({
      url,
      statusCode,
      headers: { get: (name) => lookup.get(name.toLowerCase()) },
    }) ?? 'cancel';
  }
}

class FakeRenderWindow implements WebPageRenderWindow {
  url = '';
  destroyed = false;
  destroyCount = 0;
  executeCount = 0;
  session: FakeRenderSession | undefined;
  html: unknown = '<html><body>rendered article</body></html>';
  loadURLImpl: (url: string) => Promise<void> = async (url) => {
    this.url = url;
    this.session?.respond(url);
  };
  executeImpl: () => Promise<unknown> = async () => this.html;
  private isAllowed: ((url: string) => boolean) | undefined;
  private onBlocked: ((url: string) => void) | undefined;
  private closedListener: (() => void) | undefined;
  private goneListener: ((reason: string) => void) | undefined;
  private unresponsiveListener: (() => void) | undefined;
  private domReadyListener: (() => void) | undefined;

  loadURL(url: string): Promise<void> {
    return this.loadURLImpl(url);
  }

  executeJavaScript(): Promise<unknown> {
    this.executeCount += 1;
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

  onDomReady(listener: () => void): () => void {
    this.domReadyListener = listener;
    return () => {
      this.domReadyListener = undefined;
    };
  }

  fireDomReady(): void {
    this.domReadyListener?.();
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
    renderWindow.session = this.session;
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
      mainResponse: { status: 200, headers: {} },
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
  it('回传真实主响应状态与白名单头，不复制其他响应头', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      expect(runtime.session.respond(url, 203, {
        'CF-Mitigated': 'block',
        'Set-Cookie': 'session=secret',
      })).toBe('continue');
    };
    runtime.nextWindow = renderWindow;

    const result = await createWorker(runtime).render({ url: 'https://example.com/accepted' });

    expect(result.mainResponse).toEqual({ status: 203, headers: { 'cf-mitigated': 'block' } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each<{ status: number; headers: Record<string, string> }>([
    { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } },
    { status: 405, headers: { 'X-Amzn-Waf-Action': 'captcha' } },
    { status: 403, headers: { 'cf-mitigated': 'challenge' } },
  ])('主文档访问挑战 HTTP $status 在页面执行前取消并以 access_challenge 结束', async ({ status, headers }) => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    const decisions: WebPageRenderResponseDecision[] = [];
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      decisions.push(runtime.session.respond(url, status, headers));
      await new Promise<void>(() => undefined);
    };
    runtime.nextWindow = renderWindow;
    const worker = createWorker(runtime);

    const error = await worker.render({ url: 'https://example.com/challenged' })
      .catch((failure: unknown) => failure);

    expect(decisions).toEqual(['cancel']);
    expect(error).toEqual(expect.objectContaining({
      kind: 'access_challenge',
      mainResponse: {
        status,
        headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
      },
    }));
    expect(renderWindow.executeCount).toBe(0);
    expect(renderWindow.destroyCount).toBe(1);
    // 任务结束后迟到的主框架响应不能再被放行。
    expect(runtime.session.respond('https://example.com/late')).toBe('cancel');
    await expect(worker.render({ url: 'https://example.com/next' })).resolves.toMatchObject({
      mainResponse: { status: 200 },
    });
  });

  it('没有观察到主文档响应时不补造状态码', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
    };
    runtime.nextWindow = renderWindow;

    await expect(createWorker(runtime).render({ url: 'https://example.com/no-response' }))
      .rejects.toEqual(expect.objectContaining({ kind: 'render_failed' }));
  });
  it('DOM 就绪后即可采样，拖住 load 的子资源不再导致整页超时', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      runtime.session.respond(url);
      renderWindow.fireDomReady();
      await new Promise<void>(() => undefined);
    };
    renderWindow.executeImpl = async () => (renderWindow.executeCount <= 3
      ? { readyState: 'interactive', textLength: 600, scriptCount: 0 }
      : '<html><body>article before load event</body></html>');
    runtime.nextWindow = renderWindow;

    const result = await createWorker(runtime, {
      loadTimeoutMs: 1_000,
      maxSettleDelayMs: 0,
      renderTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
    }).render({ url: 'https://example.com/hanging-image' });

    expect(result.html).toContain('article before load event');
  });

  it('错误页触发的 dom-ready 不算就绪：没有主文档响应时仍按加载失败结束', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      renderWindow.fireDomReady();
      throw new Error('ERR_BLOCKED_BY_CLIENT');
    };
    runtime.nextWindow = renderWindow;

    await expect(createWorker(runtime).render({ url: 'https://example.com/blocked' }))
      .rejects.toEqual(expect.objectContaining({ kind: 'load_failed' }));
    expect(renderWindow.executeCount).toBe(0);
  });

  it('空白应用壳等待数据请求补全正文，而不是在空白稳定时提前提取', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      runtime.session.respond(url);
      runtime.session.dataRequest(7, 'started');
    };
    renderWindow.executeImpl = async () => {
      if (renderWindow.executeCount === 4) runtime.session.dataRequest(7, 'completed');
      if (renderWindow.executeCount <= 4) return { readyState: 'complete', textLength: 7, scriptCount: 4 };
      if (renderWindow.executeCount <= 7) return { readyState: 'complete', textLength: 900, scriptCount: 4 };
      return '<html><body>data rendered article</body></html>';
    };
    runtime.nextWindow = renderWindow;

    const result = await createWorker(runtime, {
      loadTimeoutMs: 2_000,
      maxSettleDelayMs: 0,
      renderTimeoutMs: 1_000,
      totalTimeoutMs: 4_000,
    }).render({ url: 'https://example.com/app' });

    expect(result.html).toContain('data rendered article');
    expect(renderWindow.executeCount).toBe(8);
  });

  it('应用壳在既有预算内仍未渲染时报告 app_shell_not_rendered，不提取空壳 DOM', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      runtime.session.respond(url);
      runtime.session.dataRequest(9, 'started');
    };
    renderWindow.executeImpl = async () => ({ readyState: 'complete', textLength: 0, scriptCount: 5 });
    runtime.nextWindow = renderWindow;

    await expect(createWorker(runtime, {
      loadTimeoutMs: 300,
      maxSettleDelayMs: 0,
      renderTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
    }).render({ url: 'https://example.com/never' })).rejects.toEqual(
      expect.objectContaining({ kind: 'app_shell_not_rendered' }),
    );
    expect(renderWindow.destroyCount).toBe(1);
  });
  it('主框架加载被拒绝时以 load_failed 结束并保留 Chromium 数值错误码', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      throw Object.assign(new Error(" (-107) loading 'https://example.com/tls'"), { errno: -107, code: '' });
    };
    runtime.nextWindow = renderWindow;

    await expect(createWorker(runtime).render({ url: 'https://example.com/tls' })).rejects.toEqual(
      expect.objectContaining({ kind: 'load_failed', netErrorCode: -107 }),
    );
  });

  it('应用壳未渲染时附上脚本/样式表下载失败事实；自身中止和非法错误名不计入样本', async () => {
    const runtime = new FakeRenderRuntime();
    const renderWindow = new FakeRenderWindow();
    renderWindow.loadURLImpl = async (url) => {
      renderWindow.url = url;
      runtime.session.respond(url);
      runtime.session.scriptFailed(1, 'net::ERR_ABORTED');
      runtime.session.scriptFailed(2, 'injected text');
      runtime.session.scriptFailed(3, 'net::ERR_SSL_PROTOCOL_ERROR');
    };
    renderWindow.executeImpl = async () => ({ readyState: 'complete', textLength: 0, scriptCount: 5 });
    runtime.nextWindow = renderWindow;

    await expect(createWorker(runtime, {
      loadTimeoutMs: 300,
      maxSettleDelayMs: 0,
      renderTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
    }).render({ url: 'https://example.com/broken-app' })).rejects.toEqual(expect.objectContaining({
      kind: 'app_shell_not_rendered',
      subresourceFailures: { count: 2, sampleError: 'net::ERR_SSL_PROTOCOL_ERROR' },
    }));
  });

  it.each(['app_shell_not_rendered', 'load_timeout', 'load_failed'] as const)(
    '%s 保留本任务的数据请求失败，排除取消、成功与迟到事件，下一任务重新计数', async (kind) => {
      const runtime = new FakeRenderRuntime();
      const renderWindow = new FakeRenderWindow();
      renderWindow.loadURLImpl = async (url) => {
        renderWindow.url = url;
        runtime.session.respond(url);
        runtime.session.dataRequest(999, 'failed', 'net::ERR_CONNECTION_CLOSED');
        runtime.session.dataRequest(10, 'started');
        runtime.session.dataRequest(10, 'failed', 'net::ERR_EMPTY_RESPONSE');
        runtime.session.dataRequest(10, 'failed', 'net::ERR_EMPTY_RESPONSE');
        runtime.session.dataRequest(11, 'started');
        runtime.session.dataRequest(11, 'failed', 'arbitrary upstream text');
        runtime.session.dataRequest(12, 'started');
        runtime.session.dataRequest(12, 'failed', 'net::ERR_ABORTED');
        runtime.session.dataRequest(13, 'started');
        runtime.session.dataRequest(13, 'completed');
        if (kind === 'load_failed') throw Object.assign(new Error('load failed'), { errno: -107 });
        if (kind === 'load_timeout') await new Promise<void>(() => undefined);
      };
      renderWindow.executeImpl = async () => ({ readyState: 'complete', textLength: 0, scriptCount: 5 });
      runtime.nextWindow = renderWindow;
      const worker = createWorker(runtime, {
        loadTimeoutMs: 300, maxSettleDelayMs: 0, renderTimeoutMs: 1_000, totalTimeoutMs: 2_000,
      });
      try {
        await expect(worker.render({ url: 'https://example.com/failed-data' })).rejects.toMatchObject({
          kind,
          dataRequestFailures: { count: 2, sampleError: 'net::ERR_EMPTY_RESPONSE' },
          subresourceFailures: undefined,
        });

        const nextWindow = new FakeRenderWindow();
        nextWindow.loadURLImpl = async (url) => {
          nextWindow.url = url;
          runtime.session.respond(url);
          runtime.session.dataRequest(10, 'failed', 'net::ERR_CONNECTION_CLOSED');
          runtime.session.dataRequest(20, 'started');
          runtime.session.dataRequest(20, 'failed', 'net::ERR_ABORTED');
        };
        nextWindow.executeImpl = renderWindow.executeImpl;
        runtime.nextWindow = nextWindow;
        await expect(worker.render({ url: 'https://example.com/next-app' })).rejects.toMatchObject({
          kind: 'app_shell_not_rendered', dataRequestFailures: undefined, subresourceFailures: undefined,
        });
      } finally {
        await worker.dispose();
      }
    },
  );
});
