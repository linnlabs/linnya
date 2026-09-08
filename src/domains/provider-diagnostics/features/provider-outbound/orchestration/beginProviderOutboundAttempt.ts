import type {
  ProviderOutboundAttemptStart,
  ProviderOutboundDiagnosticsPort,
} from '../definitions/providerOutboundDiagnosticsPort';
import type {
  ProviderOutboundAttemptSnapshot,
  ProviderOutboundFailureSummary,
  ProviderOutboundUsageSummary,
} from '../definitions/providerOutboundAttempt';
import { completeProviderOutboundAttempt } from '../functions/transitionProviderOutboundAttempt';

type TerminalUsage = Exclude<ProviderOutboundUsageSummary, { readonly provenance: 'pending' }>;

export interface ActiveProviderOutboundAttempt {
  succeed(input: { readonly finish_reason: string; readonly usage: TerminalUsage }): void;
  fail(input: {
    readonly failure: ProviderOutboundFailureSummary;
    readonly usage: TerminalUsage;
  }): void;
}

export function beginProviderOutboundAttempt(
  diagnostics: ProviderOutboundDiagnosticsPort,
  input: ProviderOutboundAttemptStart
): ActiveProviderOutboundAttempt {
  const startedTimestamp = Date.now();
  const started: ProviderOutboundAttemptSnapshot = {
    schema_version: 2,
    ...input,
    status: 'started',
    started_at: new Date(startedTimestamp).toISOString(),
    usage: { provenance: 'pending' },
  };
  diagnostics.record(started);
  let active = true;

  function completion() {
    return {
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedTimestamp,
    };
  }

  function settle(snapshot: ProviderOutboundAttemptSnapshot): void {
    if (!active) {
      throw new Error('Provider outbound attempt 已经进入终态。');
    }
    diagnostics.record(snapshot);
    active = false;
  }

  return {
    succeed(result) {
      settle(
        completeProviderOutboundAttempt(started, {
          ...completion(),
          finish_reason: result.finish_reason,
          usage: result.usage,
        })
      );
    },
    fail(result) {
      settle(
        completeProviderOutboundAttempt(started, {
          ...completion(),
          failure: result.failure,
          usage: result.usage,
        })
      );
    },
  };
}
