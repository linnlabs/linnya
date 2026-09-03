import type {
  CanonicalInferenceEvent,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';
import type {
  AiSdkInferenceCapabilityId,
  AiSdkInferenceCapabilityInvocation,
  AiSdkInferenceRoute,
  AiSdkInferenceSurface,
} from '@linnlabs/linnkit-provider-ai-sdk';

export interface ProviderSurfaceConformanceRoute<
  Surface extends AiSdkInferenceSurface = AiSdkInferenceSurface,
> extends AiSdkInferenceRoute {
  readonly surface: Surface;
  readonly credential_profile: 'api_key' | 'bearer';
}

export function providerSurfaceRoute<
  Surface extends AiSdkInferenceSurface,
  AuthProfile extends 'api_key' | 'bearer',
>(
  capabilityId: AiSdkInferenceCapabilityId,
  surface: Surface,
  authProfile: AuthProfile
): ProviderSurfaceConformanceRoute<Surface> & { readonly credential_profile: AuthProfile } {
  return {
    model_id: `model-${surface}`,
    request_profile: surface,
    capability_id: capabilityId,
    endpoint_id: `fixture-${surface}`,
    endpoint_model_id: `provider-model-${surface}`,
    surface,
    base_url: 'https://fixture.invalid/v1',
    headers: { 'x-device-id': 'device-fixture' },
    credential_profile: authProfile,
  };
}

export function providerSurfaceInvocation(
  resolvedRoute: ProviderSurfaceConformanceRoute
): AiSdkInferenceCapabilityInvocation {
  const request: CanonicalInferenceRequest = {
    model_id: resolvedRoute.model_id,
    messages: [{ role: 'user', content: [{ type: 'text', text: '回答 fixture' }] }],
    tools: [],
    tool_choice: 'none',
    sampling: { temperature: 0, max_output_tokens: 128 },
    invocation: { trace_id: 'trace-1', attempt_id: 'attempt-1' },
  };
  return {
    request,
    route: resolvedRoute,
    credential: { profile: resolvedRoute.credential_profile, secret: 'fixture-secret' },
  };
}

export function providerSurfaceToolImageInvocation(
  resolvedRoute: ProviderSurfaceConformanceRoute
): AiSdkInferenceCapabilityInvocation {
  return {
    route: resolvedRoute,
    credential: { profile: resolvedRoute.credential_profile, secret: 'fixture-secret' },
    request: {
      model_id: resolvedRoute.model_id,
      messages: [
        { role: 'user', content: [{ type: 'text', text: '读取图片' }] },
        {
          role: 'assistant',
          parts: [{
            type: 'tool_call',
            call: { id: 'call-image', name: 'read_file', arguments: { path: '/fixture.png' } },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'call-image',
          content: [
            { type: 'text', text: '图片读取成功' },
            { type: 'image', media_type: 'image/png', bytes: Uint8Array.from([1, 2, 3]) },
          ],
        },
      ],
      tools: [],
      tool_choice: 'none',
      sampling: { max_output_tokens: 64 },
      invocation: { trace_id: 'trace-tool-image', attempt_id: 'attempt-tool-image' },
    },
  };
}

export async function collectProviderSurfaceEvents(
  stream: AsyncIterable<CanonicalInferenceEvent>
): Promise<CanonicalInferenceEvent[]> {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

export function providerSurfaceEventStream(
  lines: readonly string[],
  done = false
): Response {
  const terminal = done ? 'data: [DONE]\n\n' : '';
  return new Response(`${lines.map(line => `data: ${line}\n\n`).join('')}${terminal}`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}
