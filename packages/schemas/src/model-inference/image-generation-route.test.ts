import { describe, expect, it } from 'vitest';
import { ModelImageGenerationRouteSchema } from './image-generation-route';

describe('ModelImageGenerationRouteSchema', () => {
  it('只接纳绑定 AI SDK OpenAI-compatible image surface 的完整 route', () => {
    const route = {
      api_surface: 'openai_images_generations',
      capability_id: 'ai-sdk:openai-compatible-image-generation',
      endpoint_id: 'volcengine',
      endpoint_model_id: 'doubao-seedream-4-5-251128',
      base_url: 'https://ark.cn-beijing.volces.com/api/v3/',
      auth_profile: 'bearer',
      response_format: 'b64_json',
      max_images_per_call: 1,
    };
    expect(ModelImageGenerationRouteSchema.parse(route).base_url).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    );
    expect(ModelImageGenerationRouteSchema.safeParse({
      ...route,
      response_format: 'url',
    }).success).toBe(false);
  });
});
