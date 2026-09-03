import { describe, expect, it, vi } from 'vitest';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from 'linnkit/ports';
import type { ModelConfig } from 'src/domains/model-catalog';
import { createDefaultHostInferencePort } from './createDefaultHostInferencePort';

function model(baseUrl: string): ModelConfig {
  return {
    id: 'mock-canonical',
    model_name: 'mock-chat',
    catalog_source: 'default',
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: 'Canonical mock',
    description: 'Canonical composition fixture',
    inference_route: {
      api_surface: 'mock',
      capability_id: 'host:mock',
      endpoint_id: 'mock',
      endpoint_model_id: 'mock-chat',
      base_url: baseUrl,
      auth_profile: 'none',
      context_window_tokens: 16_384,
      max_output_tokens: 2_048,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'unavailable' },
      continuation: { tool_replay: 'unavailable' },
    },
  };
}

function request(tools: CanonicalInferenceRequest['tools'] = []): CanonicalInferenceRequest {
  return {
    model_id: 'mock-canonical',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools,
    tool_choice: 'auto',
    sampling: {},
    invocation: { trace_id: 'trace-default-host', attempt_id: 'attempt-default-host' },
  };
}

async function collect(stream: AsyncIterable<CanonicalInferenceEvent>) {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('default Host inference composition', () => {
  it('Model Catalog route 直接进入 canonical mock capability，不解析凭据', async () => {
    const fixture = model('mock://local?script=content_fast&delay_ms=0');
    const credentialResolver = { resolve: vi.fn() };
    const port = createDefaultHostInferencePort({
      model_catalog: {
        getModel: id => id === fixture.id ? fixture : undefined,
        getInferenceRouteProfileId: id => id === fixture.id ? 'mock' : undefined,
      },
      credential_resolver: credentialResolver,
    });

    const events = await collect(port.stream(request()));

    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(events[0]).toEqual({
      type: 'start',
      model_id: 'mock-canonical',
      attempt_id: 'attempt-default-host',
    });
    expect(events.filter(event => event.type === 'answer_delta').map(event => event.text).join(''))
      .toContain('content_fast');
    expect(events[events.length - 1]).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('mock 工具流只产出 canonical tool call，不执行工具', async () => {
    const fixture = model('mock://local?preset=tool_call&tool=read_probe&delay_ms=0');
    const port = createDefaultHostInferencePort({
      model_catalog: {
        getModel: id => id === fixture.id ? fixture : undefined,
        getInferenceRouteProfileId: id => id === fixture.id ? 'mock' : undefined,
      },
      credential_resolver: { resolve: vi.fn() },
    });

    const events = await collect(port.stream(request([{
      name: 'read_probe',
      description: 'Read probe',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path' } },
        required: ['path'],
        additionalProperties: false,
      },
    }])));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_call_start', name: 'read_probe' }),
      expect.objectContaining({
        type: 'tool_call_end',
        call: expect.objectContaining({ name: 'read_probe', arguments: { path: '测试' } }),
      }),
      { type: 'finish', reason: 'tool_use' },
    ]));
  });
});
