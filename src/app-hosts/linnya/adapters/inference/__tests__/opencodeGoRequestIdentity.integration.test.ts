import { describe, expect, it } from 'vitest';
import { createAiSdkLanguageModelRegistry } from '@linnlabs/linnkit-provider-ai-sdk';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type { LanguageInferenceRouteProfileId } from '@app/schemas/model-inference';
import type { ModelConfig, ModelInferenceRoute } from 'src/domains/model-catalog';
import { createInMemoryProviderOutboundDiagnostics } from 'src/domains/provider-diagnostics/features/provider-outbound';
import { version } from '../../../../../../package.json';
import { runWithInferenceSession } from '../features/request-session';
import { createDefaultHostInferencePort } from '../orchestration/createDefaultHostInferencePort';

const CHAT_ROUTE: ModelInferenceRoute = {
  api_surface: 'openai_chat_completions',
  capability_id: 'ai-sdk:openai-compatible',
  endpoint_id: 'connection-instance-fixture',
  endpoint_model_id: 'deepseek-v4.1-flash',
  base_url: 'https://fixture.invalid/v1',
  auth_profile: 'bearer',
  context_window_tokens: 128_000,
  max_output_tokens: 4_096,
  input_support: { user_image: false, tool_result_image: false },
  usage: { response_usage: 'provider_reported_optional' },
  continuation: { tool_replay: 'optional' },
};

function request(traceId: string, attemptId: string): CanonicalInferenceRequest {
  return {
    model_id: 'model-go',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [],
    tool_choice: 'none',
    sampling: { max_output_tokens: 64, reasoning_effort: 'low' },
    invocation: { trace_id: traceId, attempt_id: attemptId },
  };
}

async function collect(stream: AsyncIterable<CanonicalInferenceEvent>) {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function createPort(
  fixtureFetch: typeof fetch,
  connectionId: string | undefined = 'opencode-go',
  route: ModelInferenceRoute = CHAT_ROUTE,
  profile: LanguageInferenceRouteProfileId = 'openai_compatible_chat'
) {
  const model: ModelConfig = {
    id: 'model-go',
    model_name: route.endpoint_model_id,
    catalog_source: 'user',
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: 'Go fixture',
    description: '',
    inference_route: route,
  };
  return createDefaultHostInferencePort({
    model_catalog: {
      getModel: id => id === model.id ? model : undefined,
      getInferenceRouteProfileId: id => id === model.id ? profile : undefined,
    },
    credential_resolver: {
      resolve: async () => ({ profile: 'bearer', secret: 'fixture-secret' }),
    },
    resolve_provider_connection_id: () => connectionId,
    language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
    outbound_diagnostics: createInMemoryProviderOutboundDiagnostics(),
  });
}

function successfulChatResponse(): Response {
  const chunks = [
    { choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')
    + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('OpenCode Go Host request identity', () => {
  it('真实 SDK 发出跨 run/attempt 稳定的 Conversation 身份，并隔离并发会话', async () => {
    const headers: Headers[] = [];
    const port = createPort(async (_input, init) => {
      const received = new Headers(init?.headers);
      headers.push(received);
      if (!received.get('x-opencode-session')) {
        return new Response(JSON.stringify({ error: { type: 'MissingSessionID', message: 'missing' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return successfulChatResponse();
    });
    await Promise.all(['conversation-a', 'conversation-b'].map(conversationId =>
      runWithInferenceSession(conversationId, async () => {
        for (const [traceId, attemptId] of [
          ['run-1', 'attempt-1'],
          ['run-1', 'attempt-retry'],
          ['run-next-turn', 'attempt-2'],
        ]) {
          const events = await collect(port.stream(request(traceId, attemptId)));
          expect(events[events.length - 1]).toEqual({ type: 'finish', reason: 'stop' });
        }
      })
    ));
    expect(headers).toHaveLength(6);
    for (const sessionId of ['conversation-a', 'conversation-b']) {
      expect(headers.filter(value => value.get('x-opencode-session') === sessionId)).toHaveLength(3);
    }
    for (const value of headers) {
      expect(value.get('user-agent')).toContain(`linnya/${version}`);
      expect(value.get('authorization')).toBe('Bearer fixture-secret');
    }
  });

  it.each([
    { route: CHAT_ROUTE, profile: 'openai_compatible_chat' },
    {
      route: { ...CHAT_ROUTE, api_surface: 'openai_responses', capability_id: 'ai-sdk:openai-responses' },
      profile: 'openai_responses',
    },
    {
      route: { ...CHAT_ROUTE, api_surface: 'anthropic_messages', capability_id: 'ai-sdk:anthropic-messages' },
      profile: 'anthropic_messages',
    },
  ] satisfies { route: ModelInferenceRoute; profile: LanguageInferenceRouteProfileId }[])(
    'Go $profile 共用正式产品的 session 和自有 User-Agent，不依赖 codec 或 endpoint 命名',
    async ({ route, profile }) => {
      let headers = new Headers();
      const port = createPort(async (_input, init) => {
        headers = new Headers(init?.headers);
        return new Response(JSON.stringify({ error: { message: 'fixture stop' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }, 'opencode-go', route, profile);
      await runWithInferenceSession('conversation-all-surfaces', () =>
        collect(port.stream(request('run-surface', 'attempt-surface')))
      );
      expect(headers.get('x-opencode-session')).toBe('conversation-all-surfaces');
      expect(headers.get('user-agent')).toContain(`linnya/${version}`);
      expect(headers.get('authorization')).toBe('Bearer fixture-secret');
    }
  );

  it('无 Conversation 的独立生成使用 invocation trace，重试不使用新的 attempt 充当会话', async () => {
    const sessions: (string | null)[] = [];
    const port = createPort(async (_input, init) => {
      sessions.push(new Headers(init?.headers).get('x-opencode-session'));
      return successfulChatResponse();
    });
    await collect(port.stream(request('standalone-generation', 'attempt-first')));
    await collect(port.stream(request('standalone-generation', 'attempt-retry')));
    await collect(port.stream(request('other-generation', 'attempt-other')));
    expect(sessions).toEqual(['standalone-generation', 'standalone-generation', 'other-generation']);
  });

  it.each(['openai', 'custom-api'])(
    '%s 不因相同模型名或 URL 获得 Go 专属会话头',
    async connectionId => {
      let headers = new Headers();
      const port = createPort(async (_input, init) => {
        headers = new Headers(init?.headers);
        return successfulChatResponse();
      }, connectionId, { ...CHAT_ROUTE, base_url: 'https://opencode.ai/inference/go/v1' });
      await runWithInferenceSession('conversation-custom', () =>
        collect(port.stream(request('run-custom', 'attempt-custom')))
      );
      expect(headers.get('x-opencode-session')).toBeNull();
      expect(headers.get('user-agent')).toContain(`linnya/${version}`);
    }
  );
});
