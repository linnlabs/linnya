import type { ErrorClassification } from '../../../shared/errorClassifier';
import { generateRuntimeEventId } from '../../../contracts';
import type { ErrorEvent as AgentErrorEvent } from '../../events/agentEvents';

export function createLlmAgentErrorEvent(
  error: Error,
  classification: ErrorClassification,
): AgentErrorEvent {
  return {
    type: 'error',
    id: generateRuntimeEventId(),
    timestamp: Date.now(),
    error: error.message || 'Unknown error',
    error_code: classification.errorCode,
    retryable: classification.recoverable,
    details: {
      category: classification.category,
      reason: classification.reason,
      ...(classification.retryAfterMs === undefined
        ? {}
        : { retry_after_ms: classification.retryAfterMs }),
      ...(classification.hint === undefined ? {} : { hint: classification.hint }),
      ...(classification.metadata === undefined
        ? {}
        : { metadata: classification.metadata }),
    },
  };
}
