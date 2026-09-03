import { describe, expect, it } from 'vitest';
import { ProviderOutboundAttemptSnapshotSchema } from './index';

function safeSnapshot() {
  return {
    schema_version: 2,
    attempt_id: 'attempt-1',
    trace_id: 'trace-1',
    operation: 'language_generation',
    route: {
      model_id: 'model-1',
      endpoint_id: 'openai',
      endpoint_model_id: 'gpt-5',
      api_surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
    },
    input: {
      kind: 'language_generation',
      message_count: 1,
      message_roles: { system: 0, user: 1, assistant: 0, tool: 0 },
      tool_count: 0,
      image_count: 0,
      image_media_types: [],
    },
    status: 'started',
    started_at: '2026-08-14T01:00:00.000Z',
    usage: { provenance: 'pending' },
  };
}

describe('ProviderOutboundAttemptSnapshotSchema', () => {
  it('接受安全聚合合同，拒绝 payload、headers 与 base_url 等传输字段', () => {
    expect(ProviderOutboundAttemptSnapshotSchema.safeParse(safeSnapshot()).success).toBe(true);

    for (const forbidden of [
      { request_body: { prompt: 'secret' } },
      { headers: { authorization: 'secret' } },
      { base_url: 'https://provider.example/v1' },
      { response_body: 'secret' },
    ]) {
      expect(
        ProviderOutboundAttemptSnapshotSchema.safeParse({
          ...safeSnapshot(),
          ...forbidden,
        }).success
      ).toBe(false);
    }
  });
});
