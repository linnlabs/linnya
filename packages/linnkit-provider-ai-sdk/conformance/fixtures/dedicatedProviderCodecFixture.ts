import type {
  CanonicalAssistantReplayPart,
  CanonicalInferenceEvent,
  CanonicalInferenceMessage,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceCapabilityInvocation,
  type AiSdkInferenceCapabilityId,
  type AiSdkInferenceRoute,
  type AiSdkInferenceSurface,
} from '@linnlabs/linnkit-provider-ai-sdk';

export interface DedicatedProviderRoute extends AiSdkInferenceRoute {
  readonly credential_profile: 'api_key' | 'bearer';
}

export interface CapturedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

export function route(args: {
  readonly capabilityId: AiSdkInferenceCapabilityId;
  readonly surface: AiSdkInferenceSurface;
  readonly authProfile: 'api_key' | 'bearer';
  readonly providerModelId: string;
  readonly endpointId?: string;
  readonly baseUrl?: string;
}): DedicatedProviderRoute {
  const endpointId = args.endpointId ?? `fixture-${args.capabilityId}`;
  return {
    model_id: `model-${endpointId}`,
    request_profile: args.surface,
    capability_id: args.capabilityId,
    endpoint_id: endpointId,
    endpoint_model_id: args.providerModelId,
    surface: args.surface,
    base_url: args.baseUrl ?? 'https://fixture.invalid/v1',
    credential_profile: args.authProfile,
  };
}

function firstRequest(resolvedRoute: DedicatedProviderRoute): CanonicalInferenceRequest {
  return {
    model_id: resolvedRoute.model_id,
    messages: [{ role: 'user', content: [{ type: 'text', text: '读取文件' }] }],
    tools: [
      {
        name: 'read_file',
        description: '读取指定路径的文件',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件绝对路径' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: 'auto',
    sampling: {
      max_output_tokens: 128,
      reasoning_effort: 'high',
    },
    invocation: { trace_id: 'trace-dedicated-provider', attempt_id: 'attempt-1' },
  };
}

function invocation(
  request: CanonicalInferenceRequest,
  resolvedRoute: DedicatedProviderRoute
): AiSdkInferenceCapabilityInvocation {
  return {
    request,
    route: resolvedRoute,
    credential: { profile: resolvedRoute.credential_profile, secret: 'fixture-secret' },
  };
}

function eventStream(events: readonly Record<string, unknown>[]): Response {
  const body = `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function ndjsonStream(events: readonly Record<string, unknown>[]): Response {
  return new Response(`${events.map(event => JSON.stringify(event)).join('\n')}\n`, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

async function collect(
  stream: AsyncIterable<CanonicalInferenceEvent>
): Promise<CanonicalInferenceEvent[]> {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function replayParts(events: readonly CanonicalInferenceEvent[]): CanonicalAssistantReplayPart[] {
  const indexedParts: Array<{
    readonly index: number;
    readonly part: CanonicalAssistantReplayPart;
  }> = [];
  const toolPartIndexes = new Map<number, number>();
  for (const event of events) {
    if (event.type === 'assistant_part_end') {
      indexedParts.push({ index: event.index, part: event.part });
    } else if (event.type === 'tool_call_start') {
      toolPartIndexes.set(event.index, event.part_index);
    } else if (event.type === 'tool_call_end') {
      const partIndex = toolPartIndexes.get(event.index);
      if (partIndex === undefined) {
        throw new Error(`fixture tool_call_end 缺少 start: ${event.index}`);
      }
      indexedParts.push({
        index: partIndex,
        part: { type: 'tool_call', call: event.call },
      });
    }
  }
  return indexedParts.sort((left, right) => left.index - right.index).map(entry => entry.part);
}

export async function runToolRoundTrip(args: {
  readonly resolvedRoute: DedicatedProviderRoute;
  readonly firstResponse: readonly Record<string, unknown>[];
  readonly secondResponse: readonly Record<string, unknown>[];
  readonly responseEncoding?: 'sse' | 'ndjson';
  readonly toolResultContent?: Extract<CanonicalInferenceMessage, { role: 'tool' }>['content'];
}): Promise<{
  readonly requests: readonly CapturedRequest[];
  readonly firstEvents: readonly CanonicalInferenceEvent[];
  readonly secondEvents: readonly CanonicalInferenceEvent[];
  readonly replay: readonly CanonicalAssistantReplayPart[];
}> {
  const requests: CapturedRequest[] = [];
  const fixtureFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const requestBody = await request.clone().text();
    const body = requestBody ? JSON.parse(requestBody) : undefined;
    requests.push({
      url: request.url,
      headers: request.headers,
      body,
    });
    const response = requests.length === 1 ? args.firstResponse : args.secondResponse;
    return args.responseEncoding === 'ndjson' ? ndjsonStream(response) : eventStream(response);
  };
  const capability = createAiSdkInferenceCapability(
    args.resolvedRoute.capability_id,
    args.resolvedRoute.surface,
    { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
  );
  const initialRequest = firstRequest(args.resolvedRoute);
  const firstEvents = await collect(
    capability.stream(invocation(initialRequest, args.resolvedRoute))
  );
  const replay = replayParts(firstEvents);
  const completedToolCall = replay.find(part => part.type === 'tool_call');
  if (!completedToolCall || completedToolCall.type !== 'tool_call') {
    throw new Error('fixture 第一轮没有产出完整工具调用');
  }
  const secondRequest: CanonicalInferenceRequest = {
    ...initialRequest,
    messages: [
      ...initialRequest.messages,
      { role: 'assistant', parts: replay },
      {
        role: 'tool',
        tool_call_id: completedToolCall.call.id,
        content: args.toolResultContent ?? [{ type: 'text', text: 'file contents' }],
      },
    ],
    invocation: { trace_id: 'trace-dedicated-provider', attempt_id: 'attempt-2' },
  };
  const secondEvents = await collect(
    capability.stream(invocation(secondRequest, args.resolvedRoute))
  );

  return { requests, firstEvents, secondEvents, replay };
}
