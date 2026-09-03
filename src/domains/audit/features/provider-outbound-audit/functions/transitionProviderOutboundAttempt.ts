import type {
  ProviderOutboundAttemptSnapshot,
  ProviderOutboundFailureSummary,
  ProviderOutboundUsageSummary,
} from '../definitions/providerOutboundAttempt';

export interface CompleteProviderOutboundAttemptInput {
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly usage: Exclude<ProviderOutboundUsageSummary, { readonly provenance: 'pending' }>;
  readonly finish_reason?: string;
  readonly failure?: ProviderOutboundFailureSummary;
}

export function completeProviderOutboundAttempt(
  started: ProviderOutboundAttemptSnapshot,
  input: CompleteProviderOutboundAttemptInput
): ProviderOutboundAttemptSnapshot {
  if (started.status !== 'started') {
    throw new Error('Provider outbound attempt 只能从 started 进入终态。');
  }
  if (input.duration_ms < 0 || !Number.isFinite(input.duration_ms)) {
    throw new Error('Provider outbound attempt duration_ms 必须是有限非负数。');
  }
  if (input.failure) {
    return {
      ...started,
      status: 'failed',
      completed_at: input.completed_at,
      duration_ms: input.duration_ms,
      usage: input.usage,
      failure: input.failure,
    };
  }
  if (!input.finish_reason) {
    throw new Error('成功的 Provider outbound attempt 必须声明 finish_reason。');
  }
  return {
    ...started,
    status: 'succeeded',
    completed_at: input.completed_at,
    duration_ms: input.duration_ms,
    usage: input.usage,
    finish_reason: input.finish_reason,
  };
}
