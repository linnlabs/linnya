import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type { LanguageInferenceRouteProfileId } from '@app/schemas/model-inference';
import { createAiSdkLanguageModelRegistry } from '@linnlabs/linnkit-provider-ai-sdk';
import {
  createLinnyaAuditRuntime,
  flushLinnyaAudit,
  resetLlmAuditForTest,
  runWithLlmAuditContext,
} from 'src/domains/audit';
import type { ModelConfig, ModelInferenceRoute } from 'src/domains/model-catalog';
import { createInMemoryProviderOutboundDiagnostics } from 'src/domains/provider-diagnostics/features/provider-outbound';
import { Logger } from 'src/shared/logger';
import { createDefaultLlmCaller } from '../../runtime-assembly/graphRuntimeFactory';
import { createDefaultHostInferencePort } from '../orchestration/createDefaultHostInferencePort';

function streamResponse(chunks: readonly unknown[]): Response {
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')
    + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

function success(): Response {
  return streamResponse([
    { choices: [{ index: 0, delta: { content: 'complete answer' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]);
}

function rejected(error: Record<string, unknown>, status = 400): Response {
  return Response.json({ error }, { status });
}

function fixture(options: {
  readonly response: (attempt: number) => Response;
  readonly connection?: string | null;
  readonly surface?: Pick<ModelInferenceRoute, 'api_surface' | 'capability_id'> & {
    readonly profile: LanguageInferenceRouteProfileId;
  };
}) {
  const model: ModelConfig = {
    id: 'model-go-policy',
    model_name: 'deepseek-v4.1-flash',
    display_name: 'Go policy fixture',
    description: '',
    catalog_source: 'user',
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    inference_route: {
      api_surface: options.surface?.api_surface ?? 'openai_chat_completions',
      capability_id: options.surface?.capability_id ?? 'ai-sdk:openai-compatible',
      endpoint_id: 'fixture-connection-instance',
      endpoint_model_id: 'deepseek-v4.1-flash',
      base_url: 'https://opencode.ai/inference/go/v1',
      auth_profile: 'bearer',
      context_window_tokens: 128_000,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
  };
  const requestTimes: number[] = [];
  const requests: CanonicalInferenceRequest[] = [];
  const outbound = createInMemoryProviderOutboundDiagnostics();
  const host = createDefaultHostInferencePort({
    model_catalog: {
      getModel: id => id === model.id ? model : undefined,
      getInferenceRouteProfileId: id => id === model.id
        ? options.surface?.profile ?? 'openai_compatible_chat' : undefined,
    },
    credential_resolver: { resolve: async () => ({ profile: 'bearer', secret: 'PRIVATE_KEY' }) },
    resolve_provider_connection_id: () => options.connection === null
      ? undefined : options.connection ?? 'opencode-go',
    language_models: createAiSdkLanguageModelRegistry(async () => {
      requestTimes.push(Date.now());
      return options.response(requestTimes.length);
    }),
    outbound_diagnostics: outbound,
  });
  const caller = createDefaultLlmCaller({
    modelCatalog: {
      getModelById: id => id === model.id ? model : undefined,
      getModelsByCapability: capability => capability === 'chat' ? [model] : [],
      getModelsByUIVisibility: () => [model],
    },
    inferencePort: {
      stream(request) {
        requests.push(request);
        return host.stream(request);
      },
    },
  });
  const events: string[] = [];
  return {
    requestTimes,
    requests,
    outbound,
    host,
    events,
    call: (signal?: AbortSignal) => caller.callWithRetries(
      model.id,
      [{ role: 'user', content: 'PRIVATE_PROMPT' }],
      { allow_model_fallback: false },
      event => events.push(event.type),
      signal
    ),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  resetLlmAuditForTest();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('正式 Go 连接的未知400有限试探', () => {
  it.each([
    { api_surface: 'openai_responses', capability_id: 'ai-sdk:openai-responses', profile: 'openai_responses' },
    { api_surface: 'anthropic_messages', capability_id: 'ai-sdk:anthropic-messages', profile: 'anthropic_messages' },
  ] satisfies (Pick<ModelInferenceRoute, 'api_surface' | 'capability_id'> & {
    profile: LanguageInferenceRouteProfileId;
  })[])('Go $api_surface 同样按正式连接投影，不依赖 Chat codec', async surface => {
    const f = fixture({ surface, response: () => rejected({ type: 'invalid_request_error' }) });
    const events: CanonicalInferenceEvent[] = [];
    for await (const event of f.host.stream({
      model_id: 'model-go-policy', messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }],
      tools: [], tool_choice: 'none', sampling: { max_output_tokens: 64 },
      invocation: { trace_id: 'trace-surface', attempt_id: 'attempt-surface' },
    })) events.push(event);
    expect(events[events.length - 1]).toEqual({
      type: 'failure', kind: 'provider', code: 'provider_http_400', retryable: true, retry_category: 'other',
    });
    expect(f.requestTimes).toEqual([0]);
  });

  it('真实 SDK 400后由唯一caller等待重试，trace保留、attempt更新', async () => {
    const f = fixture({ response: attempt => attempt === 1
      ? rejected({ type: 'invalid_request_error', message: 'PRIVATE_PROVIDER_BODY' }) : success() });
    const call = f.call();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.requestTimes).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1499);
    expect(f.requestTimes).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toMatchObject({ content: 'complete answer' });
    expect(f.requestTimes).toEqual([0, 1500]);
    expect(new Set(f.requests.map(r => r.invocation.trace_id)).size).toBe(1);
    expect(new Set(f.requests.map(r => r.invocation.attempt_id)).size).toBe(2);
    expect(f.events.filter(type => type === 'stream_reset')).toHaveLength(0);
    expect(f.events.filter(type => type === 'error')).toHaveLength(0);
  });

  it('连续未知400含首次只发4次，不借用传输类六次预算', async () => {
    const f = fixture({ response: () => rejected({ type: 'invalid_request_error' }) });
    const failure = expect(f.call()).rejects.toMatchObject({ errorCode: 'llm.provider_http_400' });
    await vi.runAllTimersAsync();
    await failure;
    expect(f.requestTimes).toEqual([0, 1500, 3000, 4500]);
    expect(f.events.filter(type => type === 'error')).toHaveLength(1);
    expect(f.outbound.readLatest()).toMatchObject({
      status: 'failed', failure: { kind: 'provider', code: 'provider_http_400', retryable: true },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['openai', 'custom-api', null])('同URL与同模型的%s连接不获得试探资格', async connection => {
    const f = fixture({ connection, response: () => rejected({ type: 'invalid_request_error' }) });
    const failure = expect(f.call()).rejects.toMatchObject({ recoverable: false });
    await vi.runAllTimersAsync();
    await failure;
    expect(f.requestTimes).toEqual([0]);
    expect(vi.mocked(Logger.prototype.info).mock.calls
      .filter(([message]) => message === 'Provider failure policy_applied')).toHaveLength(0);
  });

  it.each([
    { error: { type: 'MissingSessionID' }, status: 400, code: 'opencode_session_required' },
    { error: { code: 'context_length_exceeded' }, status: 400, code: 'provider_request_too_large' },
    { error: { message: 'feature not supported' }, status: 400, code: 'provider_feature_unsupported' },
    { error: { code: 'insufficient_quota' }, status: 400, code: 'provider_quota_exhausted' },
    { error: { code: 'authentication_error' }, status: 400, code: 'provider_http_401' },
    { error: { code: 'permission_denied' }, status: 400, code: 'provider_http_403' },
    { error: { type: 'authentication_error' }, status: 401, code: 'provider_http_401' },
    { error: { type: 'permission_error' }, status: 403, code: 'provider_http_403' },
  ])('明确HTTP拒绝$code不受容错覆盖', async ({ error, status, code }) => {
    const f = fixture({ response: () => rejected(error, status) });
    const failure = expect(f.call()).rejects.toMatchObject({ errorCode: `llm.${code}`, recoverable: false });
    await vi.runAllTimersAsync();
    await failure;
    expect(f.requestTimes).toEqual([0]);
  });

  it.each([
    { code: 'context_length_exceeded', expected: 'provider_request_too_large' },
    { code: 'unsupported_feature', expected: 'provider_feature_unsupported' },
    { code: 'authentication_error', expected: 'provider_http_401' },
    { code: 'permission_denied', expected: 'provider_http_403' },
  ])('带status400的流式$code仍保留明确拒绝', async ({ code, expected }) => {
    const f = fixture({ response: () => streamResponse([{ error: { code, status: 400, message: 'PRIVATE_PROVIDER_BODY' } }]) });
    const failure = expect(f.call()).rejects.toMatchObject({ errorCode: `llm.${expected}`, recoverable: false });
    await vi.runAllTimersAsync();
    await failure;
    expect(f.requestTimes).toEqual([0]);
  });

  it('等待中取消不会发下一次请求', async () => {
    const f = fixture({ response: () => rejected({ type: 'invalid_request_error' }) });
    const controller = new AbortController();
    const failure = expect(f.call(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(750);
    controller.abort();
    await vi.runAllTimersAsync();
    await failure;
    expect(f.requestTimes).toEqual([0]);
    expect(f.events.filter(type => type === 'error')).toHaveLength(0);
  });

  it('流中未知400撤回失败片段，成功稿不混入前一attempt', async () => {
    const f = fixture({ response: attempt => attempt === 1 ? streamResponse([
      { choices: [{ index: 0, delta: { content: 'discard partial answer' }, finish_reason: null }] },
      { error: { type: 'invalid_request_error', status: 400, message: 'PRIVATE_PROVIDER_BODY' } },
    ]) : success() });
    const call = f.call();
    await vi.runAllTimersAsync();
    await expect(call).resolves.toMatchObject({ content: 'complete answer' });
    expect(f.events.filter(type => type === 'stream_reset')).toHaveLength(1);
    expect(f.requestTimes).toEqual([0, 1500]);
  });

  it('SDK原资格、Host政策和审计有效资格可按attempt关联，均不泄露正文', async () => {
    const envelopes: AuditEnvelope[] = [];
    createLinnyaAuditRuntime({ level: 'stream', sink: { emit: event => { envelopes.push(event); } } });
    const f = fixture({ response: () => rejected({ type: 'invalid_request_error', message: 'PRIVATE_PROVIDER_BODY' }) });
    const request: CanonicalInferenceRequest = {
      model_id: 'model-go-policy', messages: [{ role: 'user', content: [{ type: 'text', text: 'PRIVATE_PROMPT' }] }],
      tools: [], tool_choice: 'none', sampling: { max_output_tokens: 64 },
      invocation: { trace_id: 'trace-policy-audit', attempt_id: 'attempt-policy-audit' },
    };
    const events: CanonicalInferenceEvent[] = [];
    await runWithLlmAuditContext({ conversationId: 'conversation-policy', runId: 'run-policy', traceId: 'trace-policy-audit' }, async () => {
      for await (const event of f.host.stream(request)) events.push(event);
      await flushLinnyaAudit();
    });
    expect(events[events.length - 1]).toEqual({ type: 'failure', kind: 'provider', code: 'provider_http_400', retryable: true, retry_category: 'other' });
    expect(f.outbound.readLatest()).toMatchObject({ status: 'failed', failure: { code: 'provider_http_400', retryable: true } });
    expect(vi.mocked(Logger.prototype.warn).mock.calls).toContainEqual([
      'AI SDK failure 已投影为安全分类', expect.objectContaining({ failure_code: 'provider_http_400', retryable: false }),
    ]);
    const policyLogs = vi.mocked(Logger.prototype.info).mock.calls.filter(([message]) => message === 'Provider failure policy_applied');
    expect(policyLogs).toEqual([['Provider failure policy_applied', {
      type: 'policy_applied', policy_id: 'opencode_go_unknown_http400_probe', provider_connection_definition_id: 'opencode-go',
      attempt_id: 'attempt-policy-audit', trace_id: 'trace-policy-audit',
      original_failure: { kind: 'provider', code: 'provider_http_400', retryable: false },
      effective_failure: { kind: 'provider', code: 'provider_http_400', retryable: true, retry_category: 'other' },
    }]]);
    const response = envelopes.find(e => e.action === 'llm.response.failed');
    const stream = envelopes.find(e => e.action === 'llm.stream.failure');
    expect(response?.evidence).toContainEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        attemptId: 'attempt-policy-audit', failure: expect.objectContaining({ retryable: true }),
      }),
    }));
    expect(stream?.evidence).toContainEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        payload: expect.objectContaining({
          attemptId: 'attempt-policy-audit',
          event: expect.objectContaining({ code: 'provider_http_400', retryable: true }),
        }),
      }),
    }));
    for (const sensitive of ['PRIVATE_KEY', 'PRIVATE_PROMPT', 'PRIVATE_PROVIDER_BODY', 'https://opencode.ai']) {
      expect(JSON.stringify([policyLogs, envelopes, f.outbound.readLatest()])).not.toContain(sensitive);
    }
  });
});
