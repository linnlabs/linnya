import { errorToString as toErrorMessage, isRecord, sleep as delay } from '@linnya/foundation';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  WEB_PAGE_MAIN_RESPONSE_HEADER_MAX_CHARS,
  WEB_PAGE_NET_ERROR_NAME_PATTERN,
  WebPageRenderError,
  type WebPageMainResponse,
  type WebPageRenderCaptureMetadata,
  type WebPageSubresourceFailures,
  type WebPageRenderParams,
  type WebPageRenderResult,
} from '../../tools/web/webread/definitions/webPageRenderer';
import {
  buildDomCaptureScript,
  buildReadinessSampleScript,
  buildScrollProbeScript,
  buildScrollStepScript,
} from '../../tools/web/webread/render-capture/functions/buildRenderCaptureScripts';
import {
  parseBrowserCapturePayload,
  parseBrowserReadinessSample,
  parseBrowserScrollProbe,
} from '../../tools/web/webread/render-capture/functions/parseRenderCaptureResult';
import type { BrowserCaptureWarning } from '../../tools/web/webread/render-capture/definitions/renderCaptureContract';
import {
  detectWebAccessChallengeHeader,
  pickWebAccessChallengeHeaders,
  type WebResponseHeaderLookup,
} from '../../tools/web/shared/webAccessChallenge';
import { Logger } from '../../shared/logger';
import type {
  WebPageRenderMainFrameResponse,
  WebPageRenderNavigationTrigger,
  WebPageRenderResponseDecision,
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderSubresourceEvent,
  WebPageRenderWindow,
} from './definitions/webPageRenderRuntime';
import { electronWebPageRenderRuntime } from './electronWebPageRenderRuntime';
import {
  isAllowedPreCommitRedirectTarget,
  isAllowedRenderNavigation,
} from './functions/isAllowedRenderNavigation';
import {
  assessRenderReadinessDetailed,
  RENDER_MAIN_GROWTH_MIN_CHARS,
  type RenderReadinessReason,
} from './functions/assessRenderReadiness';

const DEFAULT_LOAD_TIMEOUT_MS = 20_000;
const DEFAULT_RENDER_TIMEOUT_MS = 5_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_DELAY_MS = 250;
const DEFAULT_MAX_SETTLE_DELAY_MS = 3_000;
const DEFAULT_READINESS_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_SCROLL_STEPS = 4;
const DEFAULT_MAX_SCROLL_TEXT_CHARS = 150_000;
const DEFAULT_MAX_SCROLL_DURATION_MS = 3_000;
const DEFAULT_SCROLL_STEP_DELAY_MS = 250;
const READINESS_POLL_INTERVAL_MS = 200;
const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_PRE_COMMIT_REDIRECTS = 5;
const READ_OUTER_HTML_SCRIPT = 'document.documentElement.outerHTML';
const READINESS_SCRIPT = buildReadinessSampleScript();
const SCROLL_PROBE_SCRIPT = buildScrollProbeScript();
const SCROLL_STEP_SCRIPT = buildScrollStepScript();
const DOM_CAPTURE_SCRIPT = buildDomCaptureScript();

export interface WebPageRenderWorkerOptions {
  readonly runtime?: WebPageRenderRuntime;
  readonly partition?: string;
  readonly session?: WebPageRenderSession;
  readonly loadTimeoutMs?: number;
  readonly renderTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly settleDelayMs?: number;
  readonly maxSettleDelayMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly maxScrollSteps?: number;
  readonly maxScrollTextChars?: number;
  readonly maxScrollDurationMs?: number;
  readonly scrollStepDelayMs?: number;
  readonly maxHtmlBytes?: number;
  readonly logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

interface WindowLifecycle {
  readonly cleanups: readonly (() => void)[];
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



function isHttpRedirectResponse(statusCode: number, headers: WebResponseHeaderLookup): boolean {
  if (
    statusCode !== 301
    && statusCode !== 302
    && statusCode !== 303
    && statusCode !== 307
    && statusCode !== 308
  ) {
    return false;
  }
  return Boolean(headers.get('location')?.trim());
}

/** Electron loadURL 拒绝时附带的数值 net 错误码；只接纳负整数。 */
function readNetErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const errno: unknown = Reflect.get(error, 'errno');
  return typeof errno === 'number' && Number.isSafeInteger(errno) && errno < 0 ? errno : undefined;
}

export class WebPageRenderWorker {
  private readonly runtime: WebPageRenderRuntime;
  private readonly partition: string;
  private readonly providedSession: WebPageRenderSession | undefined;
  private readonly loadTimeoutMs: number;
  private readonly renderTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly settleDelayMs: number;
  private readonly maxSettleDelayMs: number;
  private readonly readinessTimeoutMs: number | undefined;
  private readonly maxScrollSteps: number;
  private readonly maxScrollTextChars: number;
  private readonly maxScrollDurationMs: number;
  private readonly scrollStepDelayMs: number;
  private readonly maxHtmlBytes: number;
  private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>;

  private renderSession: WebPageRenderSession | null = null;
  private renderWindow: WebPageRenderWindow | null = null;
  private sessionSecurityCleanup: (() => void) | null = null;
  private windowLifecycle: WindowLifecycle | null = null;
  private activeAnchorUrl: string | null = null;
  private hasCommittedNavigation = false;
  private preCommitRedirectCount = 0;
  private activeMainResponse: WebPageMainResponse | null = null;
  private readonly activeDataRequests = new Set<number>();
  private sawDataRequest = false;
  private lastDataActivityAt = 0;
  private readonly activePageLoadRequests = new Set<number>();
  private lastPageLoadActivityAt = 0;
  private subresourceFailureCount = 0;
  private subresourceSampleError: string | undefined;
  private dataRequestFailureCount = 0;
  private dataRequestSampleError: string | undefined;
  private cancelActive: ((error: WebPageRenderError) => void) | null = null;
  private disposed = false;

  constructor(options: WebPageRenderWorkerOptions = {}) {
    this.runtime = options.runtime ?? electronWebPageRenderRuntime;
    this.partition = options.partition ?? `web-render:${randomUUID()}`;
    this.providedSession = options.session;
    this.loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    this.renderTimeoutMs = options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
    this.maxSettleDelayMs = options.maxSettleDelayMs ?? DEFAULT_MAX_SETTLE_DELAY_MS;
    this.readinessTimeoutMs = options.readinessTimeoutMs;
    this.maxScrollSteps = options.maxScrollSteps ?? DEFAULT_MAX_SCROLL_STEPS;
    this.maxScrollTextChars = options.maxScrollTextChars ?? DEFAULT_MAX_SCROLL_TEXT_CHARS;
    this.maxScrollDurationMs = options.maxScrollDurationMs ?? DEFAULT_MAX_SCROLL_DURATION_MS;
    this.scrollStepDelayMs = options.scrollStepDelayMs ?? DEFAULT_SCROLL_STEP_DELAY_MS;
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
    const taskDeadline = startedAt + totalTimeoutMs;
    const extractReserveMs = Math.min(this.renderTimeoutMs, Math.floor(totalTimeoutMs * 0.25));
    let rejectCancellation: ((error: WebPageRenderError) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancel = (error: WebPageRenderError): void => {
      rejectCancellation?.(error);
      this.destroyWindow();
    };
    this.cancelActive = cancel;
    this.activeAnchorUrl = params.url;
    this.hasCommittedNavigation = false;
    this.preCommitRedirectCount = 0;
    this.activeMainResponse = null;
    this.resetSubresourceTracking();

    const abort = (): void => cancel(new WebPageRenderError('aborted', '网页渲染已由调用方取消。'));
    params.signal?.addEventListener('abort', abort, { once: true });
    const totalTimer = setTimeout(() => {
      cancel(new WebPageRenderError('total_timeout', `网页渲染总耗时超过 ${totalTimeoutMs}ms。`));
    }, totalTimeoutMs);

    try {
      const renderOutcome = await this.performRender(params.url, cancellation, taskDeadline, extractReserveMs);
      this.logger.info('[web-render] 页面渲染完成', {
        finalUrl: renderOutcome.result.finalUrl,
        htmlBytes: Buffer.byteLength(renderOutcome.result.html, 'utf8'),
        readinessReason: renderOutcome.readinessReason,
        tookMs: Date.now() - startedAt,
      });
      return renderOutcome.result;
    } finally {
      clearTimeout(totalTimer);
      params.signal?.removeEventListener('abort', abort);
      // 不可信远程页面不得在任务之间继续运行；只复用隔离 session，不复用页面进程。
      this.destroyWindow();
      this.cancelActive = null;
      this.activeAnchorUrl = null;
      this.hasCommittedNavigation = false;
      this.preCommitRedirectCount = 0;
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
    const session = this.renderSession;
    this.renderSession = null;
    if (session) {
      await session.clearStorageData().catch((error: unknown) => {
        this.logger.warn('[web-render] 销毁时清理存储失败', error);
      });
    }
  }

  private async performRender(
    url: string,
    cancellation: Promise<never>,
    taskDeadline: number,
    extractReserveMs: number,
  ): Promise<{ readonly result: WebPageRenderResult; readonly readinessReason: RenderReadinessReason | 'fallback' }> {
    const { renderWindow, renderSession } = this.ensureRuntime();
    await raceCancellation(renderSession.clearStorageData(), cancellation);

    const navigationStartedAt = Date.now();
    this.lastDataActivityAt = navigationStartedAt;
    this.lastPageLoadActivityAt = navigationStartedAt;
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
    const readinessCap = this.readinessTimeoutMs ?? Math.min(this.loadTimeoutMs, DEFAULT_READINESS_TIMEOUT_MS);
    const uncappedReadinessDeadline = Math.max(
      domReadyAt + readinessCap,
      domReadyAt + this.maxSettleDelayMs,
    );
    const readinessDeadline = Math.min(
      uncappedReadinessDeadline,
      Math.max(domReadyAt, taskDeadline - extractReserveMs),
    );
    const readiness = await this.waitForRenderReadiness(renderWindow, cancellation, {
      domReadyAt,
      deadline: readinessDeadline,
    });
    if (readiness.decision === 'app_shell_not_rendered') {
      this.destroyWindow();
      throw new WebPageRenderError(
        'app_shell_not_rendered',
        '前端应用在渲染时限内未渲染出可见正文。',
        this.subresourceFailureFacts(),
      );
    }

    const scrollOutcome = readiness.sawMainTextField
      ? await this.performBoundedScroll(renderWindow, cancellation, taskDeadline, extractReserveMs)
      : { lazyContentIncomplete: false };

    const captured = await this.captureRenderedDocument(
      renderWindow,
      cancellation,
      scrollOutcome.lazyContentIncomplete,
    );

    const htmlBytes = Buffer.byteLength(captured.html, 'utf8');
    if (htmlBytes > this.maxHtmlBytes) {
      this.destroyWindow();
      throw new WebPageRenderError(
        'html_too_large',
        `渲染后的 HTML 超过上限 ${this.maxHtmlBytes} 字节。`,
      );
    }
    const finalUrl = renderWindow.getURL() || url;
    const anchorUrl = this.activeAnchorUrl ?? url;
    if (!isAllowedRenderNavigation(anchorUrl, finalUrl)) {
      this.destroyWindow();
      throw new WebPageRenderError('navigation_blocked', `网页渲染拒绝跨站导航到 ${finalUrl}。`);
    }
    const mainResponse = this.activeMainResponse;
    if (!mainResponse) {
      // 状态码只来自真实主响应；没有观察到时不补造 200。
      throw new WebPageRenderError('render_failed', '网页渲染没有观察到主文档 HTTP 响应。');
    }
    return {
      readinessReason: readiness.reason,
      result: {
        html: captured.html,
        finalUrl,
        mainResponse,
        ...(captured.capture ? { capture: captured.capture } : {}),
      },
    };
  }

  private async waitForRenderReadiness(
    renderWindow: WebPageRenderWindow,
    cancellation: Promise<never>,
    timing: { readonly domReadyAt: number; readonly deadline: number },
  ): Promise<{
    readonly decision: 'ready' | 'app_shell_not_rendered';
    readonly reason: RenderReadinessReason | 'fallback';
    readonly sawMainTextField: boolean;
  }> {
    if (this.settleDelayMs > 0) {
      await raceCancellation(delay(this.settleDelayMs), cancellation);
    }

    let peakMainTextLength: number | undefined;
    let lastMainGrowthAt = Date.now();
    let previousEffectiveLength: number | undefined;
    let previousReadyState: string | undefined;
    let stableSamples = 0;
    let sawMainTextField = false;
    while (true) {
      const snapshot = await runWithTimeout(
        raceCancellation(renderWindow.executeJavaScript(READINESS_SCRIPT), cancellation),
        this.renderTimeoutMs,
        () => new WebPageRenderError('render_timeout', `网页在 ${this.renderTimeoutMs}ms 内未响应就绪采样。`),
        () => this.destroyWindow(),
      );
      if (isRecord(snapshot) && typeof snapshot['mainTextLength'] === 'number') {
        sawMainTextField = true;
      }
      const sample = parseBrowserReadinessSample(snapshot);
      if (!sample) return { decision: 'ready', reason: 'fallback', sawMainTextField: false };

      const now = Date.now();
      const effectiveMainLength = sample.mainTextLength;
      if (peakMainTextLength === undefined) {
        peakMainTextLength = effectiveMainLength;
        lastMainGrowthAt = now;
      } else if (effectiveMainLength >= peakMainTextLength + RENDER_MAIN_GROWTH_MIN_CHARS) {
        peakMainTextLength = effectiveMainLength;
        lastMainGrowthAt = now;
      }
      if (previousEffectiveLength === undefined || sample.readyState !== previousReadyState) {
        stableSamples = 0;
      } else if (effectiveMainLength < RENDER_MAIN_GROWTH_MIN_CHARS) {
        stableSamples = effectiveMainLength === previousEffectiveLength ? stableSamples + 1 : 0;
      } else {
        stableSamples = Math.abs(effectiveMainLength - previousEffectiveLength) < RENDER_MAIN_GROWTH_MIN_CHARS
          ? stableSamples + 1
          : 0;
      }
      previousEffectiveLength = effectiveMainLength;
      previousReadyState = sample.readyState;

      const assessment = assessRenderReadinessDetailed({
        sample,
        stableSamples,
        dataRequestsInFlight: this.activeDataRequests.size,
        sawDataRequest: this.sawDataRequest,
        dataQuietMs: this.activeDataRequests.size > 0 ? 0 : now - this.lastDataActivityAt,
        pageLoadRequestsInFlight: this.activePageLoadRequests.size,
        pageLoadQuietMs: this.activePageLoadRequests.size > 0 ? 0 : now - this.lastPageLoadActivityAt,
        ...(sawMainTextField ? { mainQuietMs: now - lastMainGrowthAt } : {}),
        sinceDomReadyMs: now - timing.domReadyAt,
        maxSettleDelayMs: this.maxSettleDelayMs,
        deadlineReached: now >= timing.deadline,
      });
      if (assessment.decision !== 'wait') {
        return {
          decision: assessment.decision,
          reason: assessment.reason,
          sawMainTextField,
        };
      }
      const remainingMs = Math.max(0, timing.deadline - now);
      await raceCancellation(delay(Math.min(READINESS_POLL_INTERVAL_MS, remainingMs)), cancellation);
    }
  }

  private async performBoundedScroll(
    renderWindow: WebPageRenderWindow,
    cancellation: Promise<never>,
    taskDeadline: number,
    extractReserveMs: number,
  ): Promise<{ readonly lazyContentIncomplete: boolean }> {
    if (this.maxScrollSteps <= 0) return { lazyContentIncomplete: false };
    const maxBudgetDeadline = Math.max(Date.now(), taskDeadline - extractReserveMs);
    const scrollDeadline = Math.min(Date.now() + this.maxScrollDurationMs, maxBudgetDeadline);
    if (scrollDeadline - Date.now() < 150) return { lazyContentIncomplete: false };

    let current = parseBrowserScrollProbe(
      await runWithTimeout(
        raceCancellation(renderWindow.executeJavaScript(SCROLL_PROBE_SCRIPT), cancellation),
        this.renderTimeoutMs,
        () => new WebPageRenderError('render_timeout', `网页在 ${this.renderTimeoutMs}ms 内未响应滚动探测。`),
        () => this.destroyWindow(),
      ).catch(() => null),
    );
    if (!current || current.scrollHeight <= current.viewportHeight * 1.05 || current.atBottom) {
      return { lazyContentIncomplete: false };
    }
    if (current.mainTextLength >= this.maxScrollTextChars) {
      return { lazyContentIncomplete: true };
    }

    let anyGrowth = false;
    let lastStepGrew = false;
    let stepsRun = 0;
    while (stepsRun < this.maxScrollSteps) {
      if (Date.now() >= scrollDeadline) {
        return { lazyContentIncomplete: anyGrowth && (!current.atBottom || lastStepGrew) };
      }
      const stepped = await runWithTimeout(
        raceCancellation(renderWindow.executeJavaScript(SCROLL_STEP_SCRIPT), cancellation),
        this.renderTimeoutMs,
        () => new WebPageRenderError('render_timeout', `网页在 ${this.renderTimeoutMs}ms 内未响应滚动动作。`),
        () => this.destroyWindow(),
      ).catch(() => null);
      if (!parseBrowserScrollProbe(stepped)) {
        return { lazyContentIncomplete: false };
      }
      stepsRun += 1;

      const waitMs = Math.min(this.scrollStepDelayMs, Math.max(0, scrollDeadline - Date.now()));
      if (waitMs > 0) await raceCancellation(delay(waitMs), cancellation);
      const dataWaitDeadline = Math.min(Date.now() + 400, scrollDeadline);
      while (this.activeDataRequests.size > 0 && Date.now() < dataWaitDeadline) {
        await raceCancellation(delay(Math.min(100, Math.max(0, dataWaitDeadline - Date.now()))), cancellation);
      }

      const next = parseBrowserScrollProbe(
        await runWithTimeout(
          raceCancellation(renderWindow.executeJavaScript(SCROLL_PROBE_SCRIPT), cancellation),
          this.renderTimeoutMs,
          () => new WebPageRenderError('render_timeout', `网页在 ${this.renderTimeoutMs}ms 内未响应滚动后探测。`),
          () => this.destroyWindow(),
        ).catch(() => null),
      );
      if (!next) return { lazyContentIncomplete: false };

      const textDelta = next.mainTextLength - current.mainTextLength;
      const heightDelta = next.scrollHeight - current.scrollHeight;
      lastStepGrew = textDelta >= 40 || heightDelta >= 50;
      if (lastStepGrew) anyGrowth = true;
      current = next;

      if (current.mainTextLength >= this.maxScrollTextChars) {
        return { lazyContentIncomplete: anyGrowth || !current.atBottom };
      }
      if (!lastStepGrew && (current.atBottom || !anyGrowth) && this.activeDataRequests.size === 0) {
        return { lazyContentIncomplete: false };
      }
    }
    return { lazyContentIncomplete: anyGrowth && (!current.atBottom || lastStepGrew) };
  }

  private async captureRenderedDocument(
    renderWindow: WebPageRenderWindow,
    cancellation: Promise<never>,
    lazyContentIncomplete: boolean,
  ): Promise<{ readonly html: string; readonly capture?: WebPageRenderCaptureMetadata }> {
    let rawCapture: unknown;
    try {
      rawCapture = await runWithTimeout(
        raceCancellation(renderWindow.executeJavaScript(DOM_CAPTURE_SCRIPT), cancellation),
        this.renderTimeoutMs,
        () => new WebPageRenderError('render_timeout', `网页在 ${this.renderTimeoutMs}ms 内未完成 DOM 提取。`),
        () => this.destroyWindow(),
      );
    } catch (error: unknown) {
      if (error instanceof WebPageRenderError && (error.kind === 'render_timeout' || error.kind === 'aborted' || error.kind === 'total_timeout' || error.kind === 'unavailable' || error.kind === 'render_process_gone')) {
        throw error;
      }
      this.logger.warn('[web-render] 浏览器采集脚本执行失败，回退 outerHTML', error);
      return this.fallbackOuterHtml(renderWindow, cancellation, lazyContentIncomplete);
    }

    if (typeof rawCapture === 'string') {
      return {
        html: rawCapture,
        ...(lazyContentIncomplete ? { capture: { warnings: ['lazy_content_incomplete'] } } : {}),
      };
    }
    const payload = parseBrowserCapturePayload(rawCapture);
    if (!payload) {
      this.logger.warn('[web-render] 浏览器采集结果未通过 schema 校验，回退 outerHTML');
      return this.fallbackOuterHtml(renderWindow, cancellation, lazyContentIncomplete);
    }

    const warnings: BrowserCaptureWarning[] = [...payload.warnings];
    if (lazyContentIncomplete && !warnings.includes('lazy_content_incomplete')) {
      warnings.push('lazy_content_incomplete');
    }
    const capture: WebPageRenderCaptureMetadata = {
      ...(payload.accessBarrier ? { accessBarrier: payload.accessBarrier } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(payload.inlinedFrameResources.length > 0
        ? { inlinedFrameResources: payload.inlinedFrameResources }
        : {}),
    };
    const hasCaptureMeta = Boolean(
      capture.accessBarrier
      || (capture.warnings && capture.warnings.length > 0)
      || (capture.inlinedFrameResources && capture.inlinedFrameResources.length > 0),
    );
    return {
      html: payload.html,
      ...(hasCaptureMeta ? { capture } : {}),
    };
  }

  private async fallbackOuterHtml(
    renderWindow: WebPageRenderWindow,
    cancellation: Promise<never>,
    lazyContentIncomplete: boolean,
  ): Promise<{ readonly html: string; readonly capture?: WebPageRenderCaptureMetadata }> {
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
    return {
      html: rawHtml,
      ...(lazyContentIncomplete ? { capture: { warnings: ['lazy_content_incomplete'] } } : {}),
    };
  }

  private handleSubresource(event: WebPageRenderSubresourceEvent): void {
    if (this.activeAnchorUrl === null) return;
    if (event.category === 'script_or_style') {
      // 脚本链与 JSONP 的在途状态供就绪判定使用；只结算本任务内发出的请求。
      if (event.phase === 'started') {
        this.activePageLoadRequests.add(event.id);
        this.lastPageLoadActivityAt = Date.now();
        return;
      }
      if (this.activePageLoadRequests.delete(event.id)) this.lastPageLoadActivityAt = Date.now();
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
    this.activePageLoadRequests.clear();
    this.lastPageLoadActivityAt = Date.now();
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
      const renderSession = this.providedSession ?? this.runtime.createSession(this.partition);
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
          (candidateUrl, trigger) => this.isNavigationAllowed(candidateUrl, trigger),
          (blockedUrl) => this.handleNavigationBlocked(blockedUrl),
          (committedUrl) => this.handleDidNavigate(committedUrl),
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
    if (!cancel || this.activeAnchorUrl === null) return 'cancel';
    const mainResponse: WebPageMainResponse = {
      status: response.statusCode,
      headers: pickWebAccessChallengeHeaders(response.headers, WEB_PAGE_MAIN_RESPONSE_HEADER_MAX_CHARS),
    };
    if (detectWebAccessChallengeHeader(response.headers)) {
      this.activeMainResponse = mainResponse;
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
    if (isHttpRedirectResponse(response.statusCode, response.headers)) {
      this.activeMainResponse = null;
      return 'continue';
    }
    this.activeMainResponse = mainResponse;
    return 'continue';
  }

  private isNavigationAllowed(
    candidateUrl: string,
    trigger: WebPageRenderNavigationTrigger,
  ): boolean {
    if (this.activeAnchorUrl === null) return false;
    // 初次主框架提交前允许服务端跨站 HTTP 重定向（短链、DOI、机构迁址），
    // 受有界跳数和公共注册域准入约束；提交后锚定到提交地址，禁止跨站跳离。
    let allowed: boolean;
    if (trigger === 'redirect' && !this.hasCommittedNavigation) {
      if (this.preCommitRedirectCount >= MAX_PRE_COMMIT_REDIRECTS) {
        allowed = false;
      } else if (!isAllowedPreCommitRedirectTarget(candidateUrl)) {
        allowed = false;
      } else {
        this.preCommitRedirectCount += 1;
        allowed = true;
      }
    } else {
      allowed = isAllowedRenderNavigation(this.activeAnchorUrl, candidateUrl);
    }
    if (allowed && trigger === 'redirect') {
      this.activeMainResponse = null;
    }
    return allowed;
  }

  private handleDidNavigate(committedUrl: string): void {
    // Chromium 在请求被 net/策略拒绝（如 ERR_BLOCKED_BY_CLIENT -20）时会先触发向
    // chrome-error:// 的内部提交，跳过它才能保留 loadURL 抛出的真实 netErrorCode。
    if (
      this.activeAnchorUrl === null
      || committedUrl === 'about:blank'
      || committedUrl.startsWith('chrome-error://')
    ) {
      return;
    }
    if (!this.hasCommittedNavigation) {
      if (!isAllowedPreCommitRedirectTarget(committedUrl)) {
        this.handleNavigationBlocked(committedUrl);
        return;
      }
      this.hasCommittedNavigation = true;
      this.activeAnchorUrl = committedUrl;
      return;
    }
    if (!isAllowedRenderNavigation(this.activeAnchorUrl, committedUrl)) {
      this.handleNavigationBlocked(committedUrl);
    }
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
