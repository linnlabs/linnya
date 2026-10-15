export class ModelDiscoveryError extends Error {
  readonly code:
    | 'model_discovery.invalid_request'
    | 'model_discovery.network_error'
    | 'model_discovery.auth_failed'
    | 'model_discovery.unsupported_protocol'
    | 'model_discovery.failed';
  readonly statusCode: number;

  constructor(
    code:
      | 'model_discovery.invalid_request'
      | 'model_discovery.network_error'
      | 'model_discovery.auth_failed'
      | 'model_discovery.unsupported_protocol'
      | 'model_discovery.failed',
    message: string,
    statusCode: number = 500
  ) {
    super(message);
    this.name = 'ModelDiscoveryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
