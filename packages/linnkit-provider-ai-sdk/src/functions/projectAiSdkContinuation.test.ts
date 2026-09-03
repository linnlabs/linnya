import { describe, expect, it } from 'vitest';
import type { AiSdkInferenceRoute } from '../definitions/aiSdkInferenceSurface';
import { projectAiSdkContinuation } from './projectAiSdkContinuation';

const route = {
  model_id: 'model-1',
  request_profile: 'anthropic_messages',
  capability_id: 'ai-sdk:anthropic-messages',
  endpoint_id: 'provider-1',
  endpoint_model_id: 'provider-model-1',
  surface: 'anthropic_messages',
  base_url: 'https://fixture.invalid',
} satisfies AiSdkInferenceRoute;

describe('projectAiSdkContinuation', () => {
  it('Anthropic 只持久化 reasoning replay 所需的 text 与 signature', () => {
    expect(projectAiSdkContinuation(
      'anthropic_messages',
      route,
      { anthropic: { signature: 'signed', unrelated: 'drop-me' } },
      { type: 'reasoning', text: 'thinking' }
    )).toEqual({
      schema_version: 2,
      producer: {
        model_id: 'model-1',
        endpoint_id: 'provider-1',
        api_surface: 'anthropic_messages',
        capability_id: 'ai-sdk:anthropic-messages',
        endpoint_model_id: 'provider-model-1',
      },
      kind: 'ai-sdk:anthropic-reasoning',
      payload: { target: 'reasoning', text: 'thinking', signature: 'signed' },
    });
  });

  it('Google thought signature 绑定到对应 tool_call_id', () => {
    const googleRoute = {
      ...route,
      surface: 'google_generative_ai',
      capability_id: 'ai-sdk:google-generative-ai',
    } satisfies AiSdkInferenceRoute;
    expect(projectAiSdkContinuation(
      'google_generative_ai',
      googleRoute,
      { google: { thoughtSignature: 'thought-sig', serverToolType: 'ignored' } },
      { type: 'tool_call', tool_call_id: 'call-1' }
    )).toMatchObject({
      kind: 'ai-sdk:google-part',
      payload: {
        target: 'tool_call',
        tool_call_id: 'call-1',
        thought_signature: 'thought-sig',
      },
    });
  });

  it('OpenAI Responses 仅保留 itemId 与 reasoning encrypted content', () => {
    const responsesRoute = {
      ...route,
      surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
    } satisfies AiSdkInferenceRoute;
    expect(projectAiSdkContinuation(
      'openai_responses',
      responsesRoute,
      {
        openai: {
          itemId: 'reasoning-1',
          reasoningEncryptedContent: 'encrypted',
          annotations: ['ignored'],
        },
      },
      { type: 'reasoning', text: 'summary' }
    )).toMatchObject({
      kind: 'ai-sdk:openai-responses-part',
      payload: {
        target: 'reasoning',
        text: 'summary',
        item_id: 'reasoning-1',
        reasoning_encrypted_content: 'encrypted',
      },
    });
  });

  it('xAI Responses 使用独立 metadata namespace 持久化同一类 replay identity', () => {
    const responsesRoute = {
      ...route,
      surface: 'openai_responses',
      capability_id: 'ai-sdk:xai-responses',
    } satisfies AiSdkInferenceRoute;
    expect(projectAiSdkContinuation(
      'openai_responses',
      responsesRoute,
      {
        xai: {
          itemId: 'reasoning-1',
          reasoningEncryptedContent: 'encrypted',
          unrelated: 'drop-me',
        },
      },
      { type: 'reasoning', text: 'summary' }
    )).toMatchObject({
      kind: 'ai-sdk:xai-responses-part',
      payload: {
        target: 'reasoning',
        text: 'summary',
        item_id: 'reasoning-1',
        reasoning_encrypted_content: 'encrypted',
      },
    });
  });

  it('没有 replay metadata 时不制造空 continuation', () => {
    expect(projectAiSdkContinuation(
      'google_generative_ai',
      {
        ...route,
        surface: 'google_generative_ai',
        capability_id: 'ai-sdk:google-generative-ai',
      },
      { google: { other: true } },
      { type: 'text', text: 'answer' }
    )).toBeUndefined();
  });
});
