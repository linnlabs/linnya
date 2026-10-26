import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  WEB_PAGE_MAIN_RESPONSE_HEADER_MAX_CHARS,
  WEB_PAGE_NET_ERROR_NAME_PATTERN,
  WebPageRenderError,
  type WebPageMainResponse,
  type WebPageSubresourceFailures,
  type WebPageRenderParams,
  type WebPageRenderResult,
} from '../../tools/web/webread/definitions/webPageRenderer';
import {
  detectWebAccessChallengeHeader,
  pickWebAccessChallengeHeaders,
} from '../../tools/web/shared/webAccessChallenge';
import { Logger } from '../../shared/logger';
import type {
  WebPageRenderMainFrameResponse,
  WebPageRenderResponseDecision,
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderSubresourceEvent,
  WebPageRenderWindow,
} from './definitions/webPageRenderRuntime';
import { electronWebPageRenderRuntime } from './electronWebPageRenderRuntime';
import { isAllowedRenderNavigation } from './functions/isAllowedRenderNavigation';
import {
  assessRenderReadiness,
  type RenderReadinessSample,
} from './functions/assessRenderReadiness';

const DEFAULT_LOAD_TIMEOUT_MS = 20_000;
const DEFAULT_RENDER_TIMEOUT_MS = 5_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_DELAY_MS = 250;
const DEFAULT_MAX_SETTLE_DELAY_MS = 3_000;
const READINESS_POLL_INTERVAL_MS = 200;
const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024;
const READ_OUTER_HTML_SCRIPT = 'document.documentElement.outerHTML';
const READINESS_SCRIPT = `(() => {
  const body = document.body;
  return {
    readyState: document.readyState,
    textLength: body?.innerText?.length ?? 0,
    scriptCount: document.scripts.length,
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

/** Electron loadURL 拒绝时附带的数值 net 错误码；只接纳负整数。 */
function readNetErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const errno: unknown = Reflect.get(error, 'errno');
  return typeof errno === 'number' && Number.isSafeInteger(errno) && errno < 0 ? errno : undefined;
}

function readReadinessSample(value: unknown): RenderReadinessSample | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const objectValue: object = value;
  const readyState = Reflect.get(objectValue, 'readyState');
  const textLength = Reflect.get(objectValue, 'textLength');
  const scriptCount = Reflect.get(objectValue, 'scriptCount');
  if (typeof readyState !== 'string' || typeof textLength !== 'number') return null;
  return { readyState, textLength, scriptCount: typeof scriptCount === 'number' ? scriptCount : 0 };
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
  private activeMainResponse: WebPageMainResponse | null = null;
  private readonly activeDataRequests = new Set<number>();
  private sawDataRequest = false;
  private lastDataActivityAt = 0;
  private subresourceFailureCount = 0;
  private subresourceSampleError: string | undefined;
  private dataRequestFailureCount = 0;
  private dataRequestSampleError: string | undefined;
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
    this.activeMainResponse = null;
    this.resetSubresourceTracking();

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
      this.activeMainResponse = null;
      this.resetSubresourceTracking();
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

    const navigationStartedAt = Date.now();
    this.lastDataActivityAt = navigationStartedAt;
    let resolveDomReady: (() => void) | undefined;
    const domReady = new Promise<void>((resolve) => {
      resolveDomReady = resolve;
    });
    // 请求被拒或网络失败时 Chromium 仍会提交错误页并触发 dom-ready；只有观察到主文档响应才算本页就绪。
    const removeDomReady = renderWindow.onDomReady(() => {
      if (this.activeMainResponse) resolveDomReady?.();
    });
    // load 事件只是信号之一：DOM 就绪后，拖住 load 的子资源或之后的导航中止都交给就绪判断。
    const loading = renderWindow.loadURL(url);
    loading.catch(() => undefined);
    try {
      await runWithTimeout(
        raceCancellation(Promise.race([domReady, loading]), cancellation),
        this.loadTimeoutMs,
        () => new WebPageRenderError(
          'load_timeout',
          `网页在 ${this.loadTimeoutMs}ms 内未完成 DOM 加载。`,
          this.subresourceFailureFacts(),
        ),
        () => this.destroyWindow(),
      );
    } catch (error: unknown) {
      if (error instanceof WebPageRenderError) throw error;
      // 主框架加载被拒绝：保留 Chromium 数值错误码，由 Web 区分网络/TLS、策略拦截与渲染能力故障。
      const netErrorCode = readNetErrorCode(error);
      throw new WebPageRenderError('load_failed', `网页加载失败：${toErrorMessage(error)}`, {
        ...(netErrorCode !== undefined ? { netErrorCode } : {}),
        ...this.subresourceFailureFacts(),
      });
    } finally {
      removeDomReady();
    }

    const domReadyAt = Date.now();
    const readiness = await this.waitForRenderReadiness(renderWindow, cancellation, {
      domReadyAt,
      // 等待上限沿用既有预算：原先愿意等 load 的时长，且 DOM 就绪后至少保留一个 settle 窗口。
      deadline: Math.max(navigationStartedAt + this.loadTimeoutMs, domReadyAt + this.maxSettleDelayMs),
    });
    if (readiness === 'app_shell_not_rendered') {
      this.destroyWindow();
      throw new WebPageRenderError(
        'app_shell_not_rendered',
        '前端应用在渲染时限内未渲染出可见正文。',
        this.subresourceFailureFacts(),
      );
    }

    let rawHtml: unknown;
    try {
      rawHtml = await runWithTimeout(
        raceCancellation(renderWindow.executeJavaScript(READ_OUTER_HTML_SCRIPT), cancellation),
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
    const mainResponse = this.activeMainResponse;
    if (!mainResponse) {
      // 状态码只来自真实主响应；没有观察到时不补造 200。
      throw new WebPageRenderError('render_failed', '网页渲染没有观察到主文档 HTTP 响应。');
    }
    return { html: rawHtml, finalUrl, mainResponse };
  }

  private async waitForRenderReadiness(
    renderWindow: WebPageRenderWindow,
    cancellation: Promise<never>,
    timing: { readonly domReadyAt: number; readonly deadline: number },
  ): Promise<'ready' | 'app_shell_not_rendered'> {
    if (this.settleDelayMs > 0) {
      await raceCancellation(delay(this.settleDelayMs), cancellation);
    }

    let previousTextLength: number | undefined;
    let stableSamples = 0;
    while (true) {
      const snapshot = await runWithTimeout(
        raceCancellation(renderWindow.executeJavaScript(READINESS_SCRIPT), cancellation),
        this.renderTimeoutMs,
        () => new WebPageRenderError('render_timeout', `网页在 ${this.renderTimeoutMs}ms 内未响应就绪采样。`),
        () => this.destroyWindow(),
      );
      const sample = readReadinessSample(snapshot);
      if (!sample) return 'ready';

      stableSamples = sample.textLength === previousTextLength ? stableSamples + 1 : 0;
      previousTextLength = sample.textLength;
      const now = Date.now();
      const decision = assessRenderReadiness({
        sample,
        stableSamples,
        dataRequestsInFlight: this.activeDataRequests.size,
        sawDataRequest: this.sawDataRequest,
        dataQuietMs: this.activeDataRequests.size > 0 ? 0 : now - this.lastDataActivityAt,
        sinceDomReadyMs: now - timing.domReadyAt,
        maxSettleDelayMs: this.maxSettleDelayMs,
        deadlineReached: now >= timing.deadline,
      });
      if (decision !== 'wait') return decision;
      const remainingMs = Math.max(0, timing.deadline - now);
      await raceCancellation(delay(Math.min(READINESS_POLL_INTERVAL_MS, remainingMs)), cancellation);
    }
  }

  private handleSubresource(event: WebPageRenderSubresourceEvent): void {
    if (this.activeTargetUrl === null) return;
    if (event.category === 'script_or_style') {
      // 窗口销毁或导航中止的 ERR_ABORTED 是本工具自己的动作，不算站点资源失败。
      if (event.phase !== 'failed' || event.error === 'net::ERR_ABORTED') return;
      this.subresourceFailureCount += 1;
      if (!this.subresourceSampleError && event.error && WEB_PAGE_NET_ERROR_NAME_PATTERN.test(event.error)) {
        this.subresourceSampleError = event.error;
      }
      return;
    }
    if (event.phase === 'started') {
      this.activeDataRequests.add(event.id);
      this.sawDataRequest = true;
      this.lastDataActivityAt = Date.now();
      return;
    }
    // 只结算本任务内发出的请求；前一任务被销毁窗口的迟到结束事件不影响计数。
    if (!this.activeDataRequests.delete(event.id)) return;
    this.lastDataActivityAt = Date.now();
    // 失败也结束在途请求，但不能与成功合并后丢失原因；主动中止只结束计时，不暗示站点故障。
    if (event.phase !== 'failed' || event.error === 'net::ERR_ABORTED') return;
    this.dataRequestFailureCount += 1;
    if (!this.dataRequestSampleError && event.error && WEB_PAGE_NET_ERROR_NAME_PATTERN.test(event.error)) {
      this.dataRequestSampleError = event.error;
    }
  }

  private subresourceFailureFacts(): {
    subresourceFailures?: WebPageSubresourceFailures;
    dataRequestFailures?: WebPageSubresourceFailures;
  } {
    return {
      ...(this.subresourceFailureCount > 0 ? {
        subresourceFailures: {
          count: this.subresourceFailureCount,
          ...(this.subresourceSampleError ? { sampleError: this.subresourceSampleError } : {}),
        },
      } : {}),
      ...(this.dataRequestFailureCount > 0 ? {
        dataRequestFailures: {
          count: this.dataRequestFailureCount,
          ...(this.dataRequestSampleError ? { sampleError: this.dataRequestSampleError } : {}),
        },
      } : {}),
    };
  }

  private resetSubresourceTracking(): void {
    this.activeDataRequests.clear();
    this.sawDataRequest = false;
    this.lastDataActivityAt = Date.now();
    this.subresourceFailureCount = 0;
    this.subresourceSampleError = undefined;
    this.dataRequestFailureCount = 0;
    this.dataRequestSampleError = undefined;
  }

  private ensureRuntime(): {
    readonly renderWindow: WebPageRenderWindow;
    readonly renderSession: WebPageRenderSession;
  } {
    if (!this.renderSession) {
      const renderSession = this.runtime.createSession(this.partition);
      const removeSecurityGuards = renderSession.installSecurityGuards();
      const removeResponseObserver = renderSession.observeMainFrameResponses(
        (response) => this.handleMainFrameResponse(response),
      );
      const removeSubresourceObserver = renderSession.observeSubresources(
        (event) => this.handleSubresource(event),
      );
      this.renderSession = renderSession;
      this.sessionSecurityCleanup = () => {
        removeSubresourceObserver();
        removeResponseObserver();
        removeSecurityGuards();
      };
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

  /**
   * 访问挑战由 Web 规则判定，这里只执行“不运行挑战页”的停止动作：响应在正文交给页面前取消，
   * 本次渲染以 access_challenge 结束并保留主响应事实，不等待、求解或绕过挑战。
   */
  private handleMainFrameResponse(
    response: WebPageRenderMainFrameResponse,
  ): WebPageRenderResponseDecision {
    const cancel = this.cancelActive;
    // 没有进行中的任务时不应有页面请求；拒绝而不是放行未知加载。
    if (!cancel || this.activeTargetUrl === null) return 'cancel';
    const mainResponse: WebPageMainResponse = {
      status: response.statusCode,
      headers: pickWebAccessChallengeHeaders(response.headers, WEB_PAGE_MAIN_RESPONSE_HEADER_MAX_CHARS),
    };
    this.activeMainResponse = mainResponse;
    if (!detectWebAccessChallengeHeader(response.headers)) return 'continue';
    // 先让 runtime 同步取消响应，再结束任务并销毁窗口。
    queueMicrotask(() => {
      if (this.cancelActive !== cancel) return;
      cancel(new WebPageRenderError(
        'access_challenge',
        `主文档返回站点访问验证（HTTP ${response.statusCode}），已在页面执行前停止渲染。`,
        { mainResponse },
      ));
    });
    return 'cancel';
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
