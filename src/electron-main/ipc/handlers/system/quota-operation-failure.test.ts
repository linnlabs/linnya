import { describe, expect, it } from 'vitest';
import {
  QuotaIdRequiredError,
  QuotaPolicyNotFoundError,
} from '../../../../features/system/quota/definitions/quotaErrors';
import { createQuotaOperationFailure } from './quota-operation-failure';

describe('createQuotaOperationFailure', () => {
  it('maps predictable quota errors to stable system message keys', () => {
    expect(createQuotaOperationFailure(
      new QuotaIdRequiredError('quota:get'),
      'system.quota.getFailed',
    ).userMessage?.key).toBe('system.quota.idRequired');

    expect(createQuotaOperationFailure(
      new QuotaPolicyNotFoundError('deep_research'),
      'system.quota.consumeFailed',
    ).userMessage?.key).toBe('system.quota.policyNotFound');
  });

  it('keeps unexpected error text as diagnostic only', () => {
    const failure = createQuotaOperationFailure(
      new Error('quota store failed'),
      'system.quota.consumeFailed',
    );

    expect(failure.error).toContain('quota store failed');
    expect(failure.userMessage?.key).toBe('system.quota.consumeFailed');
    expect(failure.userMessage?.diagnostic).toContain('quota store failed');
  });
});
