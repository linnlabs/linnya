import { describe, expect, it } from 'vitest';
import { EMBEDDING_CAPABILITY_IDS, ModelEmbeddingRouteSchema } from './embedding-route';

describe('ModelEmbeddingRouteSchema', () => {
  it('normalizes an explicit OpenAI-compatible embedding route', () => {
    expect(ModelEmbeddingRouteSchema.parse({
      api_surface: 'openai_embeddings',
      capability_id: EMBEDDING_CAPABILITY_IDS.OPENAI_COMPATIBLE,
      endpoint_id: 'siliconflow',
      endpoint_model_id: 'BAAI/bge-m3',
      base_url: 'https://api.siliconflow.cn/v1/',
      auth_profile: 'bearer',
      usage: { response_usage: 'provider_reported_optional' },
    }).base_url).toBe('https://api.siliconflow.cn/v1');
  });

  it('rejects chat capability identity on an embedding route', () => {
    expect(() => ModelEmbeddingRouteSchema.parse({
      api_surface: 'openai_embeddings',
      capability_id: 'ai-sdk:openai-compatible',
      endpoint_id: 'provider',
      endpoint_model_id: 'model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      usage: { response_usage: 'provider_reported_optional' },
    })).toThrow();
  });
});
