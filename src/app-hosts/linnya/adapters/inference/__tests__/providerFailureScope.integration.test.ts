import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiSdkLanguageModelRegistry } from '@linnlabs/linnkit-provider-ai-sdk';
import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';
import type { ModelConfig, ModelInferenceRoute } from 'src/domains/model-catalog';
import { createInMemoryProviderOutboundDiagnostics } from 'src/domains/provider-diagnostics/features/provider-outbound';
import { Logger } from 'src/shared/logger';
import { createDefaultHostInferencePort } from '../orchestration/createDefaultHostInferencePort';

const route: ModelInferenceRoute = {
  api_surface: 'openai_chat_completions', capability_id: 'ai-sdk:openai-compatible',
  endpoint_id: 'linnya-cloud', endpoint_model_id: 'shared-model',
  base_url: 'https://opencode.ai/inference/go/v1', auth_profile: 'bearer',
  context_window_tokens: 128_000, max_output_tokens: 4_096,
  input_support: { user_image: false, tool_result_image: false },
  usage: { response_usage: 'provider_reported_optional' },
  continuation: { tool_replay: 'optional' },
};

const models: readonly ModelConfig[] = ['cloud', 'go', 'custom', 'unknown'].map(id => ({
  id, model_name: 'shared-model', display_name: id, description: '',
  catalog_source: id === 'cloud' ? 'cloud' : 'user',
  capabilities: ['chat'], ui_visibility: ['chat'], inference_route: route,
  ...(id === 'cloud' ? {
    credential_reference: { kind: 'host_managed' as const, credential_id: 'linnya-cloud' as const },
  } : id === 'custom' ? {
    credential_reference: { kind: 'stored_secret' as const, credential_id: 'linnya-cloud' },
  } : {}),
}));

afterEach(() => vi.restoreAllMocks());

async function concurrentFailures(error: Readonly<Record<string, unknown>>, stream: boolean) {
  vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const port = createDefaultHostInferencePort({
    model_catalog: {
      getModel: id => models.find(model => model.id === id),
      getInferenceRouteProfileId: () => 'openai_compatible_chat',
    },
    // Cloud 不在普通 Provider 配置表里；不能用 endpoint 名或 URL 猜其身份。
    resolve_provider_connection_id: id => id === 'go' ? 'opencode-go'
      : id === 'custom' ? 'custom-api' : undefined,
    credential_resolver: { resolve: async () => ({ profile: 'bearer', secret: 'fixture-secret' }) },
    language_models: createAiSdkLanguageModelRegistry(async () => stream
      ? new Response(`data: ${JSON.stringify({ error })}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      })
      : Response.json({ error }, { status: 400 })),
    outbound_diagnostics: createInMemoryProviderOutboundDiagnostics(),
  });
  return Promise.all(models.map(async model => {
    const events: CanonicalInferenceEvent[] = [];
    for await (const event of port.stream({
      model_id: model.id, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }],
      tools: [], tool_choice: 'none', sampling: { max_output_tokens: 64 },
      invocation: { trace_id: `trace-${model.id}`, attempt_id: `attempt-${model.id}` },
    })) events.push(event);
    const terminal = events[events.length - 1];
    if (!terminal || terminal.type !== 'failure') throw new Error('Expected a failure terminal');
    expect(JSON.stringify(events)).not.toContain('PRIVATE_DETAIL');
    return { model: model.id, terminal };
  }));
}

describe('产品失败分类按正式请求身份隔离', () => {
  it.each([false, true])('MissingSessionID仅在Go成为产品错误，stream=%s', async stream => {
    const results = await concurrentFailures({ type: 'MissingSessionID', status: 400, message: 'PRIVATE_DETAIL' }, stream);
    for (const result of results) {
      expect(result.terminal).toMatchObject({
        code: result.model === 'go' ? 'opencode_session_required'
          : stream ? 'provider_stream_error' : 'provider_http_400',
        retryable: false,
      });
    }
  });

  it('相同中文额度文案仅在宿主管理Cloud连接成为产品额度错误', async () => {
    const results = await concurrentFailures({ type: 'invalid_request_error', message: '今日使用次数已达上限 PRIVATE_DETAIL' }, false);
    for (const result of results) {
      expect(result.terminal).toMatchObject({
        code: result.model === 'cloud' ? 'cloud_quota_exhausted' : 'provider_http_400',
        retryable: result.model === 'go',
      });
    }
  });

  it.each([false, true])('保留既有HTTP/流式额度语义，其它连接不误称Cloud，stream=%s', async stream => {
    const results = await concurrentFailures({ code: 'insufficient_quota', status: 400, message: 'PRIVATE_DETAIL' }, stream);
    for (const result of results) {
      expect(result.terminal).toMatchObject({
        code: result.model === 'cloud' && stream ? 'cloud_quota_exhausted' : 'provider_quota_exhausted',
        retryable: false,
      });
    }
  });
});
