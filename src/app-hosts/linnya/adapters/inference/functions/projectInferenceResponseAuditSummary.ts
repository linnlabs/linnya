import type {
  CanonicalInferenceFailureKind,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';
import type { LlmResponseAuditSummaryInput } from 'src/domains/audit';
import type { ProviderOutboundUsageSummary } from 'src/domains/provider-diagnostics/features/provider-outbound';

import type { ResolvedInferenceAttemptRoute } from '../definitions/inferenceCapability';

export type TerminalProviderOutboundUsageSummary = Exclude<
  ProviderOutboundUsageSummary,
  { readonly provenance: 'pending' }
>;

export interface ProjectInferenceResponseAuditSummaryInput {
  readonly request: CanonicalInferenceRequest;
  readonly route: ResolvedInferenceAttemptRoute;
  readonly usage: TerminalProviderOutboundUsageSummary;
  readonly outcome: 'succeeded' | 'failed';
  readonly finishReason?: string;
  readonly failure?: {
    readonly kind: CanonicalInferenceFailureKind;
    readonly code: string;
    readonly retryable: boolean;
  };
}

/** 把 Host attempt 终态缩减为 Audit 允许持久化的 route、分类与 token 聚合。 */
export function projectInferenceResponseAuditSummary(
  input: ProjectInferenceResponseAuditSummaryInput
): LlmResponseAuditSummaryInput {
  const providerUsage = input.usage.provenance === 'provider_reported' ? input.usage : undefined;
  return {
    attemptId: input.request.invocation.attempt_id,
    traceId: input.request.invocation.trace_id,
    modelId: input.route.model_id,
    endpointId: input.route.endpoint_id,
    endpointModelId: input.route.endpoint_model_id,
    capabilityId: input.route.capability_id,
    apiSurface: input.route.api_surface,
    outcome: input.outcome,
    ...(input.finishReason === undefined ? {} : { finishReason: input.finishReason }),
    ...(input.failure === undefined ? {} : { failure: input.failure }),
    usage: {
      provenance: input.usage.provenance,
      ...(providerUsage?.input_tokens === undefined
        ? {}
        : { inputTokens: providerUsage.input_tokens }),
      ...(providerUsage?.output_tokens === undefined
        ? {}
        : { outputTokens: providerUsage.output_tokens }),
      ...(providerUsage?.reasoning_tokens === undefined
        ? {}
        : { reasoningTokens: providerUsage.reasoning_tokens }),
      ...(providerUsage?.total_tokens === undefined
        ? {}
        : { totalTokens: providerUsage.total_tokens }),
    },
  };
}
