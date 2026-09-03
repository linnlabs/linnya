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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStatus(error: Record<string, unknown>): number | undefined {
  return typeof error['status'] === 'number' ? error['status'] : undefined;
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
