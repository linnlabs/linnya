import type {
  CanonicalInferenceEvent,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';
import {
  projectCanonicalInferenceStreamAuditEvent,
  recordLlmResponseSummary,
  recordLlmStreamEvent,
} from 'src/domains/audit';
import {
  beginProviderOutboundAttempt,
  type ProviderOutboundDiagnosticsPort,
} from 'src/domains/provider-diagnostics/features/provider-outbound';
import type {
  InferenceCapabilityRegistry,
  InferenceCredential,
  InferenceCredentialResolver,
  InferenceModelCatalog,
  ResolvedInferenceAttemptRoute,
} from '../definitions/inferenceCapability';
import {
  INFERENCE_ADMISSION_ERROR_CODES,
  InferenceAdmissionError,
} from '../definitions/inferenceAdmissionError';
import { assertInferenceEventRoute } from '../functions/assertInferenceEventRoute';
import { projectInferenceAttemptDiagnostics } from '../functions/projectInferenceAttemptDiagnostics';
import { projectInferenceProtocolHeaders } from '../functions/projectInferenceProtocolHeaders';
import {
  projectInferenceResponseAuditSummary,
  type ProjectInferenceResponseAuditSummaryInput,
  type TerminalProviderOutboundUsageSummary,
} from '../functions/projectInferenceResponseAuditSummary';
import { resolveInferenceAttemptRoute } from '../functions/resolveInferenceAttemptRoute';

function recordResponseAudit(input: ProjectInferenceResponseAuditSummaryInput): void {
  recordLlmResponseSummary(projectInferenceResponseAuditSummary(input));
}

async function resolveCredential(
  route: ResolvedInferenceAttemptRoute,
  resolver: InferenceCredentialResolver
): Promise<InferenceCredential | undefined> {
  if (route.auth_profile === 'none') return undefined;
  const credential = await resolver.resolve({
    model_id: route.model_id,
    endpoint_id: route.endpoint_id,
    auth_profile: route.auth_profile,
  });
  if (credential.profile !== route.auth_profile || !credential.secret.trim()) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.CREDENTIAL_INVALID,
      'Resolved inference credential does not match the selected auth profile.'
    );
  }
  return credential;
}

async function* streamAttempt(
  request: CanonicalInferenceRequest,
  dependencies: HostCanonicalInferenceDependencies
): AsyncIterable<CanonicalInferenceEvent> {
  const route = resolveInferenceAttemptRoute(dependencies.model_catalog, request);
  const capability = dependencies.capability_registry.get(route.capability_id);
  if (!capability) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.CAPABILITY_MISSING,
      `No inference capability is registered for route: ${route.capability_id}`
    );
  }
  if (capability.api_surface !== route.api_surface) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.CAPABILITY_ROUTE_MISMATCH,
      `Inference capability surface does not match route: ${capability.api_surface} !== ${route.api_surface}`
    );
  }

  const credential = await resolveCredential(route, dependencies.credential_resolver);
  const protocolHeaders = projectInferenceProtocolHeaders(route);
  const headers = {
    ...(credential?.request_headers ?? {}),
    ...(protocolHeaders ?? {}),
  };
  const attemptRoute: ResolvedInferenceAttemptRoute =
    Object.keys(headers).length > 0 ? { ...route, headers } : route;
  const attempt = beginProviderOutboundAttempt(
    dependencies.outbound_diagnostics,
    projectInferenceAttemptDiagnostics(request, attemptRoute)
  );
  let usage: TerminalProviderOutboundUsageSummary = { provenance: 'not_reported' };
  let completed = false;

  try {
    for await (const event of capability.stream({ request, route: attemptRoute, credential })) {
      assertInferenceEventRoute(event, request, attemptRoute);
      recordLlmStreamEvent({
        attemptId: request.invocation.attempt_id,
        traceId: request.invocation.trace_id,
        modelId: attemptRoute.model_id,
        event: projectCanonicalInferenceStreamAuditEvent(event),
      });
      if (event.type === 'usage') {
        usage = {
          provenance: 'provider_reported',
          input_tokens: event.usage.inputTokens,
          output_tokens: event.usage.outputTokens,
          ...(event.usage.reasoningTokens === undefined
            ? {}
            : { reasoning_tokens: event.usage.reasoningTokens }),
          ...(event.usage.totalTokens === undefined
            ? {}
            : { total_tokens: event.usage.totalTokens }),
        };
      }
      if (event.type === 'finish') {
        attempt.succeed({ usage, finish_reason: event.reason });
        recordResponseAudit({
          request,
          route: attemptRoute,
          usage,
          outcome: 'succeeded',
          finishReason: event.reason,
        });
        completed = true;
      } else if (event.type === 'failure') {
        attempt.fail({
          usage,
          failure: {
            kind: event.kind,
            code: event.code,
            retryable: event.retryable,
          },
        });
        recordResponseAudit({
          request,
          route: attemptRoute,
          usage,
          outcome: 'failed',
          failure: {
            kind: event.kind,
            code: event.code,
            retryable: event.retryable,
          },
        });
        completed = true;
      }
      yield event;
      if (completed) return;
    }
  } catch (error) {
    if (!completed) {
      const failure: NonNullable<ProjectInferenceResponseAuditSummaryInput['failure']> = {
        kind: request.signal?.aborted ? 'aborted' : 'protocol',
        code: request.signal?.aborted ? 'request_aborted' : 'provider_attempt_threw',
        retryable: false,
      };
      attempt.fail({
        usage,
        failure,
      });
      recordResponseAudit({
        request,
        route: attemptRoute,
        usage,
        outcome: 'failed',
        failure,
      });
    }
    throw error;
  }

  const failure: NonNullable<ProjectInferenceResponseAuditSummaryInput['failure']> = {
    kind: 'protocol',
    code: 'provider_stream_without_terminal',
    retryable: false,
  };
  attempt.fail({
    usage,
    failure,
  });
  recordResponseAudit({
    request,
    route: attemptRoute,
    usage,
    outcome: 'failed',
    failure,
  });
}

export interface HostCanonicalInferenceDependencies {
  readonly model_catalog: InferenceModelCatalog;
  readonly capability_registry: InferenceCapabilityRegistry;
  readonly credential_resolver: InferenceCredentialResolver;
  readonly outbound_diagnostics: ProviderOutboundDiagnosticsPort;
}

export function createHostCanonicalInferencePort(
  dependencies: HostCanonicalInferenceDependencies
): CanonicalInferencePort {
  return {
    stream(request) {
      return streamAttempt(request, dependencies);
    },
  };
}
