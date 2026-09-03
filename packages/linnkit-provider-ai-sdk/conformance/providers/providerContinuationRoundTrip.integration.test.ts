import type {
  CanonicalAssistantReplayPart,
  CanonicalInferenceEvent,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';
import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceCapabilityInvocation,
  type AiSdkInferenceCapabilityId,
  type AiSdkInferenceRoute,
  type AiSdkInferenceSurface,
} from '@linnlabs/linnkit-provider-ai-sdk';

interface ConformanceRoute extends AiSdkInferenceRoute {
  readonly credential_profile: 'api_key' | 'bearer';
}

function eventStream(lines: readonly Record<string, unknown>[]): Response {
  return new Response(`${lines.map(line => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function route(
  capabilityId: AiSdkInferenceCapabilityId,
  surface: AiSdkInferenceSurface,
  authProfile: 'api_key' | 'bearer'
): ConformanceRoute {
  return {
    model_id: `model-${surface}`,
    request_profile: surface,
    capability_id: capabilityId,
    endpoint_id: `fixture-${surface}`,
    endpoint_model_id: `provider-model-${surface}`,
    surface,
    base_url: 'https://fixture.invalid/v1',
    credential_profile: authProfile,
  };
}

function firstRequest(resolvedRoute: AiSdkInferenceRoute): CanonicalInferenceRequest {
  return {
    model_id: resolvedRoute.model_id,
    messages: [{ role: 'user', content: [{ type: 'text', text: '第一轮' }] }],
    tools: [],
    tool_choice: 'none',
    sampling: { temperature: 0, max_output_tokens: 64 },
    invocation: { trace_id: 'trace-round-trip', attempt_id: 'attempt-1' },
  };
}

async function collect(stream: AsyncIterable<CanonicalInferenceEvent>): Promise<CanonicalInferenceEvent[]> {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function replayParts(events: readonly CanonicalInferenceEvent[]): CanonicalAssistantReplayPart[] {
  const toolPartIndexes = new Map<string, number>();
  const indexedParts: Array<{ readonly index: number; readonly part: CanonicalAssistantReplayPart }> = [];
  for (const event of events) {
    if (event.type === 'tool_call_start') {
      if (!event.id) throw new Error('tool call start 缺少 id');
      if (event.part_index === undefined) throw new Error(`tool call ${event.id} 缺少 part index`);
      toolPartIndexes.set(event.id, event.part_index);
      continue;
    }
    if (event.type === 'tool_call_end') {
      const index = toolPartIndexes.get(event.call.id);
      if (index === undefined) throw new Error(`tool call ${event.call.id} 缺少 part index`);
      indexedParts.push({ index, part: { type: 'tool_call', call: event.call } });
      continue;
    }
    if (event.type === 'assistant_part_end') {
      indexedParts.push({ index: event.index, part: event.part });
    }
  }
  return indexedParts.sort((left, right) => left.index - right.index).map(value => value.part);
}

function invocation(
  request: CanonicalInferenceRequest,
  resolvedRoute: ConformanceRoute
): AiSdkInferenceCapabilityInvocation {
  return {
    request,
    route: resolvedRoute,
    credential: {
      profile: resolvedRoute.credential_profile,
      secret: 'fixture-secret',
    },
  };
}

async function runTwoRounds(args: {
  readonly resolvedRoute: ConformanceRoute;
  readonly responseEvents: readonly Record<string, unknown>[];
  readonly secondResponseEvents?: readonly Record<string, unknown>[];
  readonly initialRequest?: CanonicalInferenceRequest;
  readonly buildSecondMessages?: (
    initialRequest: CanonicalInferenceRequest,
    parts: readonly CanonicalAssistantReplayPart[]
  ) => CanonicalInferenceRequest['messages'];
}): Promise<unknown> {
  let requestCount = 0;
  let secondRequestBody: unknown;
  const fixtureFetch: typeof fetch = async (_input, init) => {
    requestCount += 1;
    if (requestCount === 2 && typeof init?.body === 'string') {
      secondRequestBody = JSON.parse(init.body) as unknown;
    }
    return eventStream(requestCount === 1
      ? args.responseEvents
      : (args.secondResponseEvents ?? args.responseEvents));
  };
  const capability = createAiSdkInferenceCapability(
    args.resolvedRoute.capability_id,
    args.resolvedRoute.surface,
    { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
  );
  const initialRequest = args.initialRequest ?? firstRequest(args.resolvedRoute);
  const firstEvents = await collect(capability.stream(invocation(initialRequest, args.resolvedRoute)));
  const parts = replayParts(firstEvents);
  expect(parts.some(part => (
    part.type === 'tool_call' ? part.call.continuation : part.continuation
  )?.length)).toBe(true);

  const secondRequest: CanonicalInferenceRequest = {
    ...initialRequest,
    messages: args.buildSecondMessages?.(initialRequest, parts) ?? [
      ...initialRequest.messages,
      { role: 'assistant', parts },
      { role: 'user', content: [{ type: 'text', text: '第二轮' }] },
    ],
    invocation: { trace_id: 'trace-round-trip', attempt_id: 'attempt-2' },
  };
  const secondEvents = await collect(
    capability.stream(invocation(secondRequest, args.resolvedRoute))
  );
  expect(secondEvents[secondEvents.length - 1]).toEqual({ type: 'finish', reason: 'stop' });
  expect(requestCount).toBe(2);
  return secondRequestBody;
}

describe('official Provider continuation two-round conformance', () => {
  it('OpenAI Responses 把 reasoning item identity 经 canonical persistence 回放到第二轮 input', async () => {
    const resolvedRoute = route('ai-sdk:openai-responses', 'openai_responses', 'bearer');
    const body = await runTwoRounds({
      resolvedRoute,
      responseEvents: [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-1' },
        },
        {
          type: 'response.reasoning_summary_part.added',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
          delta: 'thinking',
        },
        {
          type: 'response.reasoning_summary_part.done',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-1' },
        },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'message', id: 'message-1', phase: 'final_answer' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message-1',
          output_index: 1,
          delta: 'answer',
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: { type: 'message', id: 'message-1', phase: 'final_answer' },
        },
        {
          type: 'response.completed',
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 1 },
              total_tokens: 2,
            },
            reasoning: null,
            service_tier: null,
          },
        },
      ],
    });

    expect(body).toMatchObject({
      store: false,
      input: expect.arrayContaining([
        expect.objectContaining({
          type: 'reasoning',
          id: 'reasoning-1',
          encrypted_content: 'encrypted-1',
        }),
      ]),
    });
    expect(JSON.stringify(body)).not.toContain('"item_reference"');
  });

  it('OpenAI Responses 以无状态完整 item 回放并行客户端工具调用', async () => {
    const resolvedRoute = route('ai-sdk:openai-responses', 'openai_responses', 'bearer');
    const initialRequest: CanonicalInferenceRequest = {
      ...firstRequest(resolvedRoute),
      tools: [
        {
          name: 'skill',
          description: '读取技能',
          parameters: { type: 'object', properties: {}, additionalProperties: true },
        },
        {
          name: 'list_files',
          description: '列出文件',
          parameters: { type: 'object', properties: {}, additionalProperties: true },
        },
      ],
      tool_choice: 'auto',
    };
    const body = await runTwoRounds({
      resolvedRoute,
      initialRequest,
      responseEvents: [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-1' },
        },
        {
          type: 'response.reasoning_summary_part.added',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
          delta: 'thinking',
        },
        {
          type: 'response.reasoning_summary_part.done',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-1' },
        },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'function_call', id: 'function-1', call_id: 'call-1', name: 'skill', arguments: '' },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'function-1',
          output_index: 1,
          delta: '{}',
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: { type: 'function_call', id: 'function-1', call_id: 'call-1', name: 'skill', arguments: '{}', status: 'completed' },
        },
        {
          type: 'response.output_item.added',
          output_index: 2,
          item: { type: 'function_call', id: 'function-2', call_id: 'call-2', name: 'list_files', arguments: '' },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'function-2',
          output_index: 2,
          delta: '{}',
        },
        {
          type: 'response.output_item.done',
          output_index: 2,
          item: { type: 'function_call', id: 'function-2', call_id: 'call-2', name: 'list_files', arguments: '{}', status: 'completed' },
        },
        {
          type: 'response.completed',
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 1 },
              total_tokens: 2,
            },
            reasoning: null,
            service_tier: null,
          },
        },
      ],
      secondResponseEvents: [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'message-2', phase: 'final_answer' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message-2',
          output_index: 0,
          delta: 'done',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'message', id: 'message-2', phase: 'final_answer' },
        },
        {
          type: 'response.completed',
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 2,
            },
            reasoning: null,
            service_tier: null,
          },
        },
      ],
      buildSecondMessages: (request, parts) => [
        ...request.messages,
        { role: 'assistant', parts },
        { role: 'tool', tool_call_id: 'call-1', content: [{ type: 'text', text: 'skill loaded' }] },
        { role: 'tool', tool_call_id: 'call-2', content: [{ type: 'text', text: 'files listed' }] },
      ],
    });

    expect(body).toMatchObject({
      store: false,
      input: expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-1' }),
        expect.objectContaining({ type: 'function_call', call_id: 'call-1', name: 'skill' }),
        expect.objectContaining({ type: 'function_call', call_id: 'call-2', name: 'list_files' }),
        expect.objectContaining({ type: 'function_call_output', call_id: 'call-1', output: 'skill loaded' }),
        expect.objectContaining({ type: 'function_call_output', call_id: 'call-2', output: 'files listed' }),
      ]),
    });
    expect(JSON.stringify(body)).not.toContain('"item_reference"');
  });

  it('Anthropic 把 thinking signature 经 canonical persistence 回放到第二轮 messages', async () => {
    const resolvedRoute = route('ai-sdk:anthropic-messages', 'anthropic_messages', 'api_key');
    const body = await runTwoRounds({
      resolvedRoute,
      responseEvents: [
        {
          type: 'message_start',
          message: {
            id: 'message-1',
            model: resolvedRoute.endpoint_model_id,
            role: 'assistant',
            usage: { input_tokens: 1 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'thinking' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-1' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        { type: 'message_stop' },
      ],
    });

    expect(body).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.arrayContaining([
            { type: 'thinking', thinking: 'thinking', signature: 'signed-1' },
          ]),
        }),
      ]),
    });
  });

  it('Google 把 thoughtSignature 经 canonical persistence 回放到第二轮 contents', async () => {
    const resolvedRoute = route('ai-sdk:google-generative-ai', 'google_generative_ai', 'api_key');
    const body = await runTwoRounds({
      resolvedRoute,
      responseEvents: [{
        candidates: [{
          content: {
            role: 'model',
            parts: [
              { text: 'thinking', thought: true, thoughtSignature: 'thought-signed-1' },
              { text: 'answer', thoughtSignature: 'answer-signed-1' },
            ],
          },
          finishReason: 'STOP',
        }],
        usageMetadata: null,
      }],
    });

    expect(body).toMatchObject({
      contents: expect.arrayContaining([
        expect.objectContaining({
          role: 'model',
          parts: expect.arrayContaining([
            {
              text: 'thinking',
              thought: true,
              thoughtSignature: 'thought-signed-1',
            },
            { text: 'answer', thoughtSignature: 'answer-signed-1' },
          ]),
        }),
      ]),
    });
  });
});
