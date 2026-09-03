import { describe, expect, it } from 'vitest';
import { ModelRerankingRouteSchema } from './reranking-route';

describe('ModelRerankingRouteSchema', () => {
  it('accepts the approved Cohere-compatible profile and normalizes base URL', () => {
    expect(ModelRerankingRouteSchema.parse({
      api_surface: 'cohere_rerank',
      capability_id: 'ai-sdk:cohere-compatible-reranking',
      endpoint_id: 'siliconflow',
      endpoint_model_id: 'BAAI/bge-reranker-v2-m3',
      base_url: 'https://api.siliconflow.cn/v1/',
      auth_profile: 'bearer',
      usage: { response_usage: 'provider_reported_optional' },
    }).base_url).toBe('https://api.siliconflow.cn/v1');
  });
});
