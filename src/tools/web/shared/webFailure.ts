import {
  WEB_ESCALATABLE_FAILURE_KIND_VALUES,
  WEB_EXTRACTION_FAILURE_STAGE_VALUES,
  WEB_FAILURE_KIND_VALUES,
  WEB_READ_ESCALATION_REASON_VALUES,
  WEB_RENDER_FAILURE_KIND_VALUES,
  type WebReadEscalationReason,
  type WebRenderFailureKind,
  type EscalatableWebFailureKind,
  type WebExtractionFailureStage,
  type WebFailureKind,
} from '@app/schemas';
import type { WebPageResource } from '../definitions/webDocument';
import { isWebAccessChallengeSignal, type WebAccessChallengeSignal } from './webAccessChallenge';

export type {
  EscalatableWebFailureKind,
  WebExtractionFailureStage,
  WebFailureKind,
} from '@app/schemas';

export const ESCALATABLE: ReadonlySet<EscalatableWebFailureKind> =
  new Set<EscalatableWebFailureKind>([...WEB_ESCALATABLE_FAILURE_KIND_VALUES]);

export const WEB_RETRY_STOP_REASONS = [
  'not_retryable', 'retry_limit', 'retry_after_limit', 'budget_exhausted',
] as const;
export type WebRetryStopReason = typeof WEB_RETRY_STOP_REASONS[number];

export interface WebFailureDetails<TReason extends string = WebFailureKind> {
  readonly escalationReason?: TReason;
  readonly initialFailureKind?: WebFailureKind;
  readonly previousFailureKind?: WebFailureKind;
  readonly renderAttempted?: boolean;
  readonly extractionStage?: WebExtractionFailureStage;
  /** 仅供审计/诊断使用；不会写入网页正文 observation。 */
  readonly status?: number;
  readonly contentType?: string;
  readonly finalUrl?: string;
  readonly redirectCount?: number;
  readonly attempt?: number;
  readonly retryCount?: number;
  readonly failureStage?: WebFailureStage;
  readonly renderFailureKind?: WebRenderFailureKind;
  readonly rpcCode?: number;
  readonly retryAfterMs?: number;
  readonly retryStopReason?: WebRetryStopReason;
  readonly bodyBytes?: number;
  readonly maxBodyBytes?: number;
  readonly declaredBodyBytes?: number;
  readonly challengeSignal?: WebAccessChallengeSignal;
  /** 本地渲染主框架加载失败时 Chromium 的数值 net 错误码。 */
  readonly netErrorCode?: number;
  /** 本地渲染中脚本/样式表下载失败次数与首个合法 net 错误名。 */
  readonly subresourceFailureCount?: number;
  readonly subresourceError?: string;
  /** 已实际抽取的外部资源；不得混入安全诊断，展示必须进入不可信边界。 */
  readonly resources?: readonly WebPageResource[];
}

export type WebFailureStage =
  | 'search'
  | 'local_http'
  | 'local_render'
  | 'managed_reader'
  | 'read_ladder';
const FAILURE_STAGES: readonly WebFailureStage[] = [
  'search',
  'local_http',
  'local_render',
  'managed_reader',
  'read_ladder',
];

export interface WebFailureDiagnostics {
  readonly status?: number;
  readonly contentType?: string;
  readonly finalUrl?: string;
  readonly redirectCount?: number;
  readonly attempt?: number;
  readonly retryCount?: number;
  readonly failureStage?: WebFailureStage;
  readonly initialFailureKind?: WebFailureKind;
  readonly previousFailureKind?: WebFailureKind;
  readonly escalationReason?: WebReadEscalationReason;
  readonly renderAttempted?: boolean;
  readonly renderFailureKind?: WebRenderFailureKind;
  readonly extractionStage?: WebExtractionFailureStage;
  readonly rpcCode?: number;
  readonly retryAfterMs?: number;
  readonly retryStopReason?: WebRetryStopReason;
  readonly bodyBytes?: number;
  readonly maxBodyBytes?: number;
  readonly declaredBodyBytes?: number;
  readonly challengeSignal?: WebAccessChallengeSignal;
  readonly netErrorCode?: number;
  readonly subresourceFailureCount?: number;
  readonly subresourceError?: string;
}

/** 与渲染 port 的 net 错误名形状一致；任意错误文字不进入诊断。 */
const NET_ERROR_NAME_PATTERN = /^net::ERR_[A-Z0-9_]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStatus(error: Record<string, unknown>): number | undefined {
  return typeof error['status'] === 'number' ? error['status'] : undefined;
}

function sanitizeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return ''; // 非 URL 的任意文本不是诊断事实。
  }
}

/** Content-Type 是外部响应头；错误文案和诊断都只展示合法 MIME token。 */
export function getWebDiagnosticMimeType(value: unknown): string | undefined {
  const mimeType =
    typeof value === 'string' ? value.split(';')[0]?.trim().toLowerCase() : undefined;
  return mimeType && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
    ? mimeType
    : undefined;
}

/** 只抽取可安全写入结构化日志的失败字段，不携带响应正文。 */
export function getWebFailureDiagnostics(error: unknown): WebFailureDiagnostics {
  if (!isRecord(error)) return {};
  const details = isRecord(error['details']) ? error['details'] : undefined;
  const read = (key: keyof WebFailureDiagnostics): unknown => error[key] ?? details?.[key];
  const status = read('status');
  const contentType = read('contentType');
  const finalUrl = read('finalUrl') ?? error['url'];
  const redirectCount = read('redirectCount');
  const attempt = read('attempt');
  const retryCount = read('retryCount');
  const failureStage = FAILURE_STAGES.find(value => value === read('failureStage'));
  const initialFailureKind = WEB_FAILURE_KIND_VALUES.find(
    value => value === read('initialFailureKind')
  );
  const previousFailureKind = WEB_FAILURE_KIND_VALUES.find(
    value => value === read('previousFailureKind')
  );
  const escalationReason = WEB_READ_ESCALATION_REASON_VALUES.find(
    value => value === read('escalationReason')
  );
  const renderFailureKind = WEB_RENDER_FAILURE_KIND_VALUES.find(
    value => value === read('renderFailureKind')
  );
  const extractionStage = WEB_EXTRACTION_FAILURE_STAGE_VALUES.find(
    value => value === read('extractionStage')
  );
  const renderAttempted = read('renderAttempted');
  const rpcCode = read('rpcCode');
  const retryStopReason = WEB_RETRY_STOP_REASONS.find(value => value === read('retryStopReason'));
  const challengeSignal = read('challengeSignal');
  const netErrorCode = read('netErrorCode');
  const subresourceFailureCount = read('subresourceFailureCount');
  const subresourceError = read('subresourceError');
  const numericFacts: { -readonly [K in
    'retryAfterMs' | 'bodyBytes' | 'maxBodyBytes' | 'declaredBodyBytes']?: number } = {};
  for (const key of ['retryAfterMs', 'bodyBytes', 'maxBodyBytes', 'declaredBodyBytes'] as const) {
    const value = read(key);
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) numericFacts[key] = value;
  }
  const mimeType = getWebDiagnosticMimeType(contentType);
  const safeUrl = typeof finalUrl === 'string' ? sanitizeDiagnosticUrl(finalUrl) : undefined;
  return {
    ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? { status }
      : {}),
    ...(mimeType ? { contentType: mimeType } : {}),
    ...(safeUrl ? { finalUrl: safeUrl } : {}),
    ...(typeof redirectCount === 'number' && Number.isInteger(redirectCount)
      ? { redirectCount }
      : {}),
    ...(typeof attempt === 'number' && Number.isInteger(attempt) ? { attempt } : {}),
    ...(typeof retryCount === 'number' && Number.isInteger(retryCount) ? { retryCount } : {}),
    ...(failureStage ? { failureStage } : {}),
    ...(initialFailureKind ? { initialFailureKind } : {}),
    ...(previousFailureKind ? { previousFailureKind } : {}),
    ...(escalationReason ? { escalationReason } : {}),
    ...(renderFailureKind ? { renderFailureKind } : {}),
    ...(extractionStage ? { extractionStage } : {}),
    ...(typeof renderAttempted === 'boolean' ? { renderAttempted } : {}),
    ...(typeof rpcCode === 'number' && Number.isSafeInteger(rpcCode) ? { rpcCode } : {}),
    ...numericFacts,
    ...(retryStopReason ? { retryStopReason } : {}),
    ...(isWebAccessChallengeSignal(challengeSignal) ? { challengeSignal } : {}),
    ...(typeof netErrorCode === 'number' && Number.isSafeInteger(netErrorCode) && netErrorCode < 0
      ? { netErrorCode } : {}),
    ...(typeof subresourceFailureCount === 'number' && Number.isSafeInteger(subresourceFailureCount)
      && subresourceFailureCount > 0 ? { subresourceFailureCount } : {}),
    ...(typeof subresourceError === 'string' && NET_ERROR_NAME_PATTERN.test(subresourceError)
      ? { subresourceError } : {}),
  };
}

function hasDnsFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isRecord(current); depth += 1) {
    const code = current['code'];
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL' || code === 'ENODATA') {
      return true;
    }
    current = current['cause'];
  }
  return false;
}

export class WebFailureError<TReason extends string = WebFailureKind> extends Error {
  readonly kind: WebFailureKind;
  readonly status?: number;
  readonly details?: WebFailureDetails<TReason>;
  readonly cause?: unknown;

  constructor(
    kind: WebFailureKind,
    message: string,
    options?: {
      status?: number;
      details?: WebFailureDetails<TReason>;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'WebFailureError';
    this.kind = kind;
    this.status = options?.status;
    this.details = options?.details;
    this.cause = options?.cause;
  }

  /** 禁用后备读取时仍公开已确认的访问阻断根因，不能把所有 managed_disabled 当作拦截。 */
  get code(): WebFailureKind {
    if (this.kind !== 'managed_disabled') return this.kind;
    const reason =
      this.details?.previousFailureKind ??
      this.details?.initialFailureKind ??
      this.details?.escalationReason;
    return isWebAccessBlockKind(reason) ? reason : this.kind;
  }
}

export type WebAccessBlockKind = 'captcha' | 'http_403' | 'login_required';

export function isWebAccessBlockKind(kind: unknown): kind is WebAccessBlockKind {
  return kind === 'captcha' || kind === 'http_403' || kind === 'login_required';
}

/** 只读正式分类；网络、超时、抽取失败和未知 provider_error 都不推断为站点拦截。 */
export function getWebAccessBlockKind(error: unknown): WebAccessBlockKind | undefined {
  const kind = getWebFailureKind(error);
  if (isWebAccessBlockKind(kind)) return kind;
  if (kind !== 'managed_disabled' || !(error instanceof WebFailureError)) return undefined;
  const code = error.code;
  return isWebAccessBlockKind(code) ? code : undefined;
}

export function getWebExtractionFailureStage(
  error: unknown
): WebExtractionFailureStage | undefined {
  if (!isRecord(error) || error['kind'] !== 'extraction_error') return undefined;
  const details = error['details'];
  if (!isRecord(details)) return undefined;
  const stage = details['extractionStage'];
  return typeof stage === 'string'
    ? WEB_EXTRACTION_FAILURE_STAGE_VALUES.find(candidate => candidate === stage)
    : undefined;
}

export function isEscalatableWebFailureKind(
  kind: WebFailureKind
): kind is EscalatableWebFailureKind {
  for (const escalatableKind of ESCALATABLE) {
    if (escalatableKind === kind) return true;
  }
  return false;
}

export function getWebFailureKind(error: unknown): WebFailureKind {
  if (isRecord(error)) {
    if (error['name'] === 'AbortError') return 'aborted';
    const status = readStatus(error);
    // 阶段包装会把 HTTP 状态提升到顶层；已确认的挑战信号必须先于 403/404 状态归类。
    const details = isRecord(error['details']) ? error['details'] : undefined;
    if (isWebAccessChallengeSignal(error['challengeSignal'] ?? details?.['challengeSignal'])) {
      return 'captcha';
    }
    if (status === 403) return 'http_403';
    if (status === 404) return 'http_404';
    if (hasDnsFailure(error)) return 'dns_error';
    const kind = error['kind'];
    if (typeof kind === 'string') {
      const knownKind = WEB_FAILURE_KIND_VALUES.find(candidate => candidate === kind);
      if (knownKind) return knownKind;
    }
  }
  return 'provider_error';
}

/** 只格式化已知枚举/数值，使模型与持久工具错误能看见根因，不转述上游 message/detail。 */
export function formatWebFailureDiagnostics(error: unknown): string {
  const diagnostics = getWebFailureDiagnostics(error);
  const fields = [
    diagnostics.failureStage ? `stage=${diagnostics.failureStage}` : '',
    diagnostics.renderFailureKind ? `render=${diagnostics.renderFailureKind}` : '',
    diagnostics.extractionStage ? `extraction=${diagnostics.extractionStage}` : '',
    diagnostics.initialFailureKind ? `initial=${diagnostics.initialFailureKind}` : '',
    diagnostics.previousFailureKind ? `previous=${diagnostics.previousFailureKind}` : '',
    diagnostics.escalationReason ? `escalation=${diagnostics.escalationReason}` : '',
    diagnostics.status !== undefined ? `HTTP=${diagnostics.status}` : '',
    diagnostics.challengeSignal ? `challenge=${diagnostics.challengeSignal}` : '',
    diagnostics.netErrorCode !== undefined ? `net_error=${diagnostics.netErrorCode}` : '',
    diagnostics.subresourceFailureCount !== undefined
      ? `subresource_failures=${diagnostics.subresourceFailureCount}` : '',
    diagnostics.subresourceError ? `subresource_error=${diagnostics.subresourceError}` : '',
    diagnostics.rpcCode !== undefined ? `rpc_code=${diagnostics.rpcCode}` : '',
    diagnostics.attempt !== undefined ? `attempt=${diagnostics.attempt}` : '',
    diagnostics.retryCount !== undefined ? `retry_count=${diagnostics.retryCount}` : '',
    diagnostics.retryAfterMs !== undefined ? `retry_after_ms=${diagnostics.retryAfterMs}` : '',
    diagnostics.retryStopReason ? `retry_stop=${diagnostics.retryStopReason}` : '',
    diagnostics.contentType ? `mime=${diagnostics.contentType}` : '',
    diagnostics.bodyBytes !== undefined ? `received_bytes=${diagnostics.bodyBytes}` : '',
    diagnostics.maxBodyBytes !== undefined ? `limit_bytes=${diagnostics.maxBodyBytes}` : '',
    diagnostics.declaredBodyBytes !== undefined ? `declared_length=${diagnostics.declaredBodyBytes}` : '',
  ].filter(Boolean);
  return fields.length ? `Web diagnostics: ${fields.join(', ')}.` : '';
}
