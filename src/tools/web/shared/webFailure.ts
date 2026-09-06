import {
  WEB_ESCALATABLE_FAILURE_KIND_VALUES,
  WEB_EXTRACTION_FAILURE_STAGE_VALUES,
  WEB_FAILURE_KIND_VALUES,
  type EscalatableWebFailureKind,
  type WebExtractionFailureStage,
  type WebFailureKind,
} from '@app/schemas';

export type {
  EscalatableWebFailureKind,
  WebExtractionFailureStage,
  WebFailureKind,
} from '@app/schemas';

export const ESCALATABLE: ReadonlySet<EscalatableWebFailureKind> = new Set<EscalatableWebFailureKind>([
  ...WEB_ESCALATABLE_FAILURE_KIND_VALUES,
]);

export interface WebFailureDetails<TReason extends string = WebFailureKind> {
  readonly escalationReason?: TReason;
  readonly initialFailureKind?: WebFailureKind;
  readonly previousFailureKind?: WebFailureKind;
  readonly previousFailureMessage?: string;
  readonly renderAttempted?: boolean;
  readonly extractionStage?: WebExtractionFailureStage;
  /** 仅供审计/诊断使用；不会写入网页正文 observation。 */
  readonly status?: number;
  readonly contentType?: string;
  readonly finalUrl?: string;
  readonly redirectCount?: number;
  readonly attempt?: number;
  readonly retryCount?: number;
}

export interface WebFailureDiagnostics {
  readonly status?: number;
  readonly contentType?: string;
  readonly finalUrl?: string;
  readonly redirectCount?: number;
  readonly attempt?: number;
  readonly retryCount?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStatus(error: Record<string, unknown>): number | undefined {
  return typeof error['status'] === 'number' ? error['status'] : undefined;
}

function readString(error: Record<string, unknown>, key: string): string | undefined {
  return typeof error[key] === 'string' && error[key].trim().length > 0
    ? error[key].trim()
    : undefined;
}

function sanitizeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
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
  return {
    ...(typeof status === 'number' && Number.isInteger(status) ? { status } : {}),
    ...(typeof contentType === 'string' && contentType ? { contentType } : {}),
    ...(typeof finalUrl === 'string' && finalUrl ? { finalUrl: sanitizeDiagnosticUrl(finalUrl) } : {}),
    ...(typeof redirectCount === 'number' && Number.isInteger(redirectCount) ? { redirectCount } : {}),
    ...(typeof attempt === 'number' && Number.isInteger(attempt) ? { attempt } : {}),
    ...(typeof retryCount === 'number' && Number.isInteger(retryCount) ? { retryCount } : {}),
  };
}

const CHALLENGE_MARKERS = [
  /captcha/i,
  /verify\s+(?:you|that)\s+you(?:'re| are)\s+human/i,
  /human\s+verification/i,
  /access\s+(?:verification|challenge)/i,
  /challenge-platform/i,
  /cloudflare/i,
  /akamai\s+bot/i,
  /huawei\s*cloud\s*waf/i,
  /人机验证|安全验证|访问验证|验证码/,
] as const;

/** 仅凭状态码不足以断定挑战；必须同时出现有限的结构化页面特征。 */
export function isWebChallengeResponse(
  status: number | undefined,
  bodyPreview: string | undefined,
): boolean {
  if (status === undefined || bodyPreview === undefined) return false;
  if (status !== 403 && status !== 419 && status !== 429) return false;
  return CHALLENGE_MARKERS.some((marker) => marker.test(bodyPreview));
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

  constructor(kind: WebFailureKind, message: string, options?: {
    status?: number;
    details?: WebFailureDetails<TReason>;
    cause?: unknown;
  }) {
    super(message);
    this.name = 'WebFailureError';
    this.kind = kind;
    this.status = options?.status;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}

export function getWebExtractionFailureStage(
  error: unknown,
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
  kind: WebFailureKind,
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
    if (isWebChallengeResponse(status, readString(error, 'bodyPreview'))) return 'captcha';
    if (status === 403) return 'http_403';
    if (status === 404) return 'http_404';
    if (hasDnsFailure(error)) return 'dns_error';
    const kind = error['kind'];
    if (typeof kind === 'string') {
      const knownKind = WEB_FAILURE_KIND_VALUES.find((candidate) => candidate === kind);
      if (knownKind) return knownKind;
    }
  }
  return 'provider_error';
}
