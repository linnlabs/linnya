import type { RerankingFailureKind } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
export type { RerankingRequest, RerankingItem, RerankingUsage, RerankingResult, RerankingFailureKind, RerankingPort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';

export class RerankingFailure extends Error {
  constructor(
    readonly kind: RerankingFailureKind,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'RerankingFailure';
  }
}
