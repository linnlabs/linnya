import type { RoutedRuntimeEvent } from '../../../contracts';
import type { RuntimeFailureFact } from '../types';

/** 校验 Runtime error 已具备 lifecycle 结算所需的稳定分类字段。 */
export function isRuntimeFailureFact(event: RoutedRuntimeEvent): event is RuntimeFailureFact {
  return event.type === 'error'
    && typeof event.error_code === 'string'
    && typeof event.retryable === 'boolean';
}
