import { Logger } from 'src/shared/logger';
import type { ProviderFailurePolicyApplication } from '../definitions/providerFailurePolicy';

const logger = new Logger('ProviderFailurePolicy');

/** SDK 原分类保留；同 attempt 的 Host 政策事实说明有效资格为何不同。 */
export function recordProviderFailurePolicyApplication(
  application: ProviderFailurePolicyApplication,
  identity: { readonly attempt_id: string; readonly trace_id: string }
): void {
  logger.info('Provider failure policy_applied', {
    type: application.type,
    policy_id: application.policy_id,
    provider_connection_definition_id: application.provider_connection_definition_id,
    attempt_id: identity.attempt_id,
    trace_id: identity.trace_id,
    original_failure: {
      kind: application.original_failure.kind,
      code: application.original_failure.code,
      retryable: application.original_failure.retryable,
    },
    effective_failure: {
      kind: application.effective_failure.kind,
      code: application.effective_failure.code,
      retryable: application.effective_failure.retryable,
      retry_category: application.effective_failure.retry_category,
    },
  });
}
