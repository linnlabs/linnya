import type { ModelConfig } from '../../../definitions/modelCatalog';

export type CloudModelsFetchFailureReason =
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'invalid_payload';

export interface CloudModelsFetchResult {
  readonly success: boolean;
  readonly models: ModelConfig[];
  readonly purposeDefaults: Record<string, string>;
  readonly failureReason?: CloudModelsFetchFailureReason;
}
