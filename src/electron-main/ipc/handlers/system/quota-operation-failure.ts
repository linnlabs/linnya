import {
  createOperationFailure,
  createUserFacingMessage,
} from '@app/schemas';
import {
  QuotaIdRequiredError,
  QuotaPolicyNotFoundError,
} from '../../../../features/system/quota/definitions/quotaErrors';

export type QuotaOperationFallbackKey =
  | 'system.quota.getFailed'
  | 'system.quota.consumeFailed';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(error: unknown, key: string) {
  const diagnostic = getErrorMessage(error);
  return createOperationFailure(
    diagnostic,
    createUserFacingMessage(key, { diagnostic }),
  );
}

export function createQuotaOperationFailure(
  error: unknown,
  fallbackKey: QuotaOperationFallbackKey,
) {
  if (error instanceof QuotaIdRequiredError) {
    return failure(error, 'system.quota.idRequired');
  }

  if (error instanceof QuotaPolicyNotFoundError) {
    return failure(error, 'system.quota.policyNotFound');
  }

  return failure(error, fallbackKey);
}
