import type { CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type { ProviderOutboundAttemptStart } from 'src/domains/provider-diagnostics/features/provider-outbound';
import type { ResolvedInferenceAttemptRoute } from '../definitions/inferenceCapability';

export function projectInferenceAttemptDiagnostics(
  request: CanonicalInferenceRequest,
  route: ResolvedInferenceAttemptRoute
): ProviderOutboundAttemptStart {
  const messageRoles: Record<'system' | 'user' | 'assistant' | 'tool', number> = {
    system: 0,
    user: 0,
    assistant: 0,
    tool: 0,
  };
  const imageMediaTypes = new Set<string>();
  let imageCount = 0;

  for (const message of request.messages) {
    messageRoles[message.role] += 1;
    if (message.role === 'system' || message.role === 'assistant') continue;
    for (const block of message.content) {
      if (block.type !== 'image') continue;
      imageCount += 1;
      imageMediaTypes.add(block.media_type);
    }
  }

  return {
    attempt_id: request.invocation.attempt_id,
    trace_id: request.invocation.trace_id,
    operation: 'language_generation',
    route: {
      model_id: route.model_id,
      endpoint_id: route.endpoint_id,
      endpoint_model_id: route.endpoint_model_id,
      api_surface: route.api_surface,
      capability_id: route.capability_id,
    },
    input: {
      kind: 'language_generation',
      message_count: request.messages.length,
      message_roles: messageRoles,
      tool_count: request.tools.length,
      image_count: imageCount,
      image_media_types: [...imageMediaTypes].sort(),
    },
  };
}
