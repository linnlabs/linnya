export type OllamaModelFetchErrorCode =
  | 'INVALID_URL'
  | 'CONNECTION_FAILED'
  | 'TIMEOUT'
  | 'STATUS_FAILED'
  | 'NO_MODELS'
  | 'UNKNOWN';

export interface OllamaModelFetchErrorDetails {
  readonly code: OllamaModelFetchErrorCode;
  readonly target?: string;
  readonly statusCode?: number;
  readonly detail?: string;
}

export class OllamaModelFetchError extends Error {
  readonly code: OllamaModelFetchErrorCode;
  readonly target?: string;
  readonly statusCode?: number;
  readonly detail?: string;

  constructor(details: OllamaModelFetchErrorDetails) {
    super(details.detail ?? details.code);
    this.name = 'OllamaModelFetchError';
    this.code = details.code;
    this.target = details.target;
    this.statusCode = details.statusCode;
    this.detail = details.detail;
  }
}

export function isOllamaModelFetchError(error: unknown): error is OllamaModelFetchError {
  return error instanceof OllamaModelFetchError;
}
