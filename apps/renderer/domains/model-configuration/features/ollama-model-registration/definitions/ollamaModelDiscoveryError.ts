export type OllamaModelDiscoveryErrorCode =
  | 'INVALID_URL'
  | 'CONNECTION_FAILED'
  | 'TIMEOUT'
  | 'STATUS_FAILED'
  | 'NO_MODELS'
  | 'UNKNOWN';

interface OllamaModelDiscoveryErrorDetails {
  readonly code: OllamaModelDiscoveryErrorCode;
  readonly target?: string;
  readonly statusCode?: number;
}

export class OllamaModelDiscoveryError extends Error {
  readonly code: OllamaModelDiscoveryErrorCode;
  readonly target?: string;
  readonly statusCode?: number;

  constructor(details: OllamaModelDiscoveryErrorDetails) {
    super(details.code);
    this.name = 'OllamaModelDiscoveryError';
    this.code = details.code;
    this.target = details.target;
    this.statusCode = details.statusCode;
  }
}

export function isOllamaModelDiscoveryError(error: unknown): error is OllamaModelDiscoveryError {
  return error instanceof OllamaModelDiscoveryError;
}
