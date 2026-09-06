import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  WebPageRenderError,
  type WebPageRenderParams,
  type WebPageRenderResult,
} from '../../tools/web/webread/definitions/webPageRenderer';
import { Logger } from '../../shared/logger';
import type {
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderWindow,
} from './definitions/webPageRenderRuntime';
import { electronWebPageRenderRuntime } from './electronWebPageRenderRuntime';
import { isAllowedRenderNavigation } from './functions/isAllowedRenderNavigation';

const DEFAULT_LOAD_TIMEOUT_MS = 20_000;
const DEFAULT_RENDER_TIMEOUT_MS = 5_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_DELAY_MS = 250;
const DEFAULT_MAX_SETTLE_DELAY_MS = 3_000;
const READINESS_POLL_INTERVAL_MS = 200;
const READINESS_STABLE_SAMPLES = 2;
const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024;
const READ_OUTER_HTML_SCRIPT = 'document.documentElement.outerHTML';
const READINESS_SCRIPT = `(() => {
  const body = document.body;
  return {
    readyState: document.readyState,
    textLength: body?.innerText?.length ?? 0,
    htmlLength: document.documentElement?.outerHTML?.length ?? 0,
  };
})()`;

export interface WebPageRenderWorkerOptions {
  readonly runtime?: WebPageRenderRuntime;
  readonly partition?: string;
  readonly loadTimeoutMs?: number;
  readonly renderTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly settleDelayMs?: number;
  readonly maxSettleDelayMs?: number;
  readonly maxHtmlBytes?: number;
  readonly logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

interface WindowLifecycle {
  readonly cleanups: readonly (() => void)[];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function raceCancellation<T>(operation: Promise<T>, cancellation: Promise<never>): Promise<T> {
  return Promise.race([operation, cancellation]);
}

async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  createError: () => WebPageRenderError,
  onTimeout: (error: WebPageRenderError) => void,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = createError();
      onTimeout(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isReadinessSnapshot(value: unknown): value is {
  readonly readyState: string;
  readonly textLength: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const objectValue: object = value;
  const readyState = Reflect.get(objectValue, 'readyState');
  const textLength = Reflect.get(objectValue, 'textLength');
  return typeof readyState === 'string' && typeof textLength === 'number';
}

export class WebPageRenderWorker {
  private readonly runtime: WebPageRenderRuntime;
  private readonly partition: string;
  private readonly loadTimeoutMs: number;
  private readonly renderTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly settleDelayMs: number;
  private readonly maxSettleDelayMs: number;
  private readonly maxHtmlBytes: number;
  private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>;

  private renderSession: WebPageRenderSession | null = null;
  private renderWindow: WebPageRenderWindow | null = null;
  private sessionSecurityCleanup: (() => void) | null = null;
  private windowLifecycle: WindowLifecycle | null = null;
  private activeTargetUrl: string | null = null;
  private cancelActive: ((error: WebPageRenderError) => void) | null = null;
  private disposed = false;

  constructor(options: WebPageRenderWorkerOptions = {}) {
    this.runtime = options.runtime ?? electronWebPageRenderRuntime;
    this.partition = options.partition ?? `web-render:${randomUUID()}`;
    this.loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    this.renderTimeoutMs = options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
    this.maxSettleDelayMs = options.maxSettleDelayMs ?? DEFAULT_MAX_SETTLE_DELAY_MS;
    this.maxHtmlBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
    this.logger = options.logger ?? new Logger('WebPageRenderWorker');
  }

  async render(params: WebPageRenderParams): Promise<WebPageRenderResult> {
    if (this.disposed) {
      throw new WebPageRenderError('unavailable', '本地网页渲染 worker 已销毁。');
    }
    if (this.cancelActive) {
      throw new WebPageRenderError('unavailable', '本地网页渲染 worker 正在处理其他页面。');
    }
    if (params.signal?.aborted) {
      throw new WebPageRenderError('aborted', '网页渲染已由调用方取消。');
    }

    const startedAt = Date.now();
    const totalTimeoutMs = params.timeoutMs ?? this.totalTimeoutMs;
    let rejectCancellation: ((error: WebPageRenderError) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancel = (error: WebPageRenderError): void => {
      rejectCancellation?.(error);
      this.destroyWindow();
    };
    this.cancelActive = cancel;
    this.activeTargetUrl = params.url;

    const abort = (): void => cancel(new WebPageRenderError('aborted', '网页渲染已由调用方取消。'));
    params.signal?.addEventListener('abort', abort, { once: true });
    const totalTimer = setTimeout(() => {
      cancel(new WebPageRenderError('total_timeout', `网页渲染总耗时超过 ${totalTimeoutMs}ms。`));
    }, totalTimeoutMs);

    try {
      const result = await this.performRender(params.url, cancellation);
      this.logger.info('[web-render] 页面渲染完成', {
        finalUrl: result.finalUrl,
        htmlBytes: Buffer.byteLength(result.html, 'utf8'),
        tookMs: Date.now() - startedAt,
      });
      return result;
    } finally {
      clearTimeout(totalTimer);
      params.signal?.removeEventListener('abort', abort);
      // 不可信远程页面不得在任务之间继续运行；只复用隔离 session，不复用页面进程。
      this.destroyWindow();
      this.cancelActive = null;
      this.activeTargetUrl = null;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelActive?.(new WebPageRenderError('unavailable', '本地网页渲染 worker 正在退出。'));
    this.destroyWindow();
    this.sessionSecurityCleanup?.();
    this.sessionSecurityCleanup = null;
    this.renderSession = null;
  }

  private async performRender(
    url: string,
    cancellation: Promise<never>,
  ): Promise<WebPageRenderResult> {
    const { renderWindow, renderSession } = this.ensureRuntime();
    await raceCancellation(renderSession.clearStorageData(), cancellation);

    try {
      await runWithTimeout(
        raceCancellation(renderWindow.loadURL(url), cancellation),
        this.loadTimeoutMs,
        () => new WebPageRenderError('load_timeout', `网页在 ${this.loadTimeoutMs}ms 内未完成加载。`),
        () => this.destroyWindow(),
      );
    } catch (error: unknown) {
      if (error instanceof WebPageRenderError) throw error;
      throw new WebPageRenderError('render_failed', `网页加载失败：${toErrorMessage(error)}`);
    }

    const renderOperation = (async (): Promise<unknown> => {
      await this.waitForDocumentReadiness(renderWindow, cancellation);
      return await raceCancellation(
        renderWindow.executeJavaScript(READ_OUTER_HTML_SCRIPT),
        cancellation,
      );
    })();

    let rawHtml: unknown;
    try {
      rawHtml = await runWithTimeout(
        renderOperation,
        this.renderTimeoutMs,
        () => new WebPageRenderError('render_timeout', `网页在 ${this.renderTimeoutMs}ms 内未完成 DOM 提取。`),
        () => this.destroyWindow(),
      );
    } catch (error: unknown) {
      if (error instanceof WebPageRenderError) throw error;
      throw new WebPageRenderError('render_failed', `网页 DOM 提取失败：${toErrorMessage(error)}`);
    }

    if (typeof rawHtml !== 'string') {
      throw new WebPageRenderError('render_failed', '网页 DOM 提取没有返回 HTML 字符串。');
    }
    const htmlBytes = Buffer.byteLength(rawHtml, 'utf8');
    if (htmlBytes > this.maxHtmlBytes) {
      this.destroyWindow();
      throw new WebPageRenderError(
        'html_too_large',
        `渲染后的 HTML 超过上限 ${this.maxHtmlBytes} 字节。`,
      );
    }
    const finalUrl = renderWindow.getURL() || url;
    if (!isAllowedRenderNavigation(url, finalUrl)) {
      this.destroyWindow();
      throw new WebPageRenderError('navigation_blocked', `网页渲染拒绝跨站导航到 ${finalUrl}。`);
    }
    return { html: rawHtml, finalUrl };
  }

  private async waitForDocumentReadiness(
    renderWindow: WebPageRenderWindow,
    cancellation: Promise<never>,
  ): Promise<void> {
    if (this.settleDelayMs > 0) {
      await raceCancellation(delay(this.settleDelayMs), cancellation);
    }

    const deadline = Date.now() + Math.max(this.settleDelayMs, this.maxSettleDelayMs);
    let previousTextLength: number | undefined;
    let stableSamples = 0;
    while (Date.now() < deadline) {
      const snapshot = await raceCancellation(
        renderWindow.executeJavaScript(READINESS_SCRIPT),
        cancellation,
      );
      if (!isReadinessSnapshot(snapshot)) return;

      if (snapshot.readyState === 'complete' && snapshot.textLength === previousTextLength) {
        stableSamples += 1;
      } else {
        stableSamples = 0;
      }
      previousTextLength = snapshot.textLength;
      if (snapshot.readyState === 'complete' && stableSamples >= READINESS_STABLE_SAMPLES) return;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return;
      await raceCancellation(delay(Math.min(READINESS_POLL_INTERVAL_MS, remainingMs)), cancellation);
    }
  }

  private ensureRuntime(): {
    readonly renderWindow: WebPageRenderWindow;
    readonly renderSession: WebPageRenderSession;
  } {
    if (!this.renderSession) {
      this.renderSession = this.runtime.createSession(this.partition);
      this.sessionSecurityCleanup = this.renderSession.installSecurityGuards();
    }
    if (!this.renderWindow || this.renderWindow.isDestroyed()) {
      const renderWindow = this.runtime.createWindow({ partition: this.partition });
      const cleanups = [
        renderWindow.installNavigationGuards(
          (candidateUrl) => this.activeTargetUrl !== null
            && isAllowedRenderNavigation(this.activeTargetUrl, candidateUrl),
          (blockedUrl) => this.handleNavigationBlocked(blockedUrl),
        ),
        renderWindow.onClosed(() => this.handleWindowUnavailable('渲染窗口已关闭。')),
        renderWindow.onRenderProcessGone((reason) => {
          this.handleWindowUnavailable(`渲染进程已退出：${reason}。`, 'render_process_gone');
        }),
        renderWindow.onUnresponsive(() => {
          this.handleWindowUnavailable('渲染进程无响应。', 'render_process_gone');
        }),
      ];
      this.renderWindow = renderWindow;
      this.windowLifecycle = { cleanups };
    }
    return { renderWindow: this.renderWindow, renderSession: this.renderSession };
  }

  private handleNavigationBlocked(blockedUrl: string): void {
    const error = new WebPageRenderError(
      'navigation_blocked',
      `网页渲染拒绝跨站导航到 ${blockedUrl}。`,
    );
    this.cancelActive?.(error);
    this.destroyWindow();
  }

  private handleWindowUnavailable(
    message: string,
    kind: 'unavailable' | 'render_process_gone' = 'unavailable',
  ): void {
    this.cancelActive?.(new WebPageRenderError(kind, message));
    this.detachWindow();
    this.renderWindow = null;
  }

  private destroyWindow(): void {
    const renderWindow = this.renderWindow;
    this.detachWindow();
    this.renderWindow = null;
    if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy();
  }

  private detachWindow(): void {
    const lifecycle = this.windowLifecycle;
    this.windowLifecycle = null;
    if (!lifecycle) return;
    for (const cleanup of lifecycle.cleanups) {
      try {
        cleanup();
      } catch (error: unknown) {
        this.logger.warn('[web-render] 清理窗口监听器失败', error);
      }
    }
  }
}
