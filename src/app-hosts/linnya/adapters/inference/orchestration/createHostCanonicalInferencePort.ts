import type {
  CanonicalInferenceEvent,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
} from 'linnkit/ports';
import {
  beginProviderOutboundAttempt,
  type ProviderOutboundAuditPort,
  type ProviderOutboundUsageSummary,
} from 'src/domains/audit/features/provider-outbound-audit';
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
import { projectInferenceAttemptAudit } from '../functions/projectInferenceAttemptAudit';
import { projectInferenceProtocolHeaders } from '../functions/projectInferenceProtocolHeaders';
import { resolveInferenceAttemptRoute } from '../functions/resolveInferenceAttemptRoute';

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
    dependencies.outbound_audit,
    projectInferenceAttemptAudit(request, attemptRoute)
  );
  let usage: ProviderOutboundUsageSummary = { provenance: 'not_reported' };
  let completed = false;

  try {
    for await (const event of capability.stream({ request, route: attemptRoute, credential })) {
      assertInferenceEventRoute(event, request, attemptRoute);
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
        completed = true;
      }
      yield event;
      if (completed) return;
    }
  } catch (error) {
    if (!completed) {
      attempt.fail({
        usage,
        failure: {
          kind: request.signal?.aborted ? 'aborted' : 'protocol',
          code: request.signal?.aborted ? 'request_aborted' : 'provider_attempt_threw',
          retryable: false,
        },
      });
    }
    throw error;
  }

  attempt.fail({
    usage,
    failure: {
      kind: 'protocol',
      code: 'provider_stream_without_terminal',
      retryable: false,
    },
  });
}

export interface HostCanonicalInferenceDependencies {
  readonly model_catalog: InferenceModelCatalog;
  readonly capability_registry: InferenceCapabilityRegistry;
  readonly credential_resolver: InferenceCredentialResolver;
  readonly outbound_audit: ProviderOutboundAuditPort;
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
