import { describe, expect, it } from 'vitest';
import {
  ModelDiscoveryRequestSchema,
  DiscoveredModelSchema,
  ModelDiscoveryResponseSchema,
} from './index';

describe('ModelDiscovery schemas', () => {
  it('normalizes base_url correctly for openai_compatible format', () => {
    const parsed = ModelDiscoveryRequestSchema.parse({
      api_format: 'openai_compatible',
      base_url: 'https://api.openai.com',
      api_key: 'sk-test',
    });
    expect(parsed.base_url).toBe('https://api.openai.com/v1');
  });

  it('preserves existing pathname in base_url', () => {
    const parsed = ModelDiscoveryRequestSchema.parse({
      api_format: 'openai_compatible',
      base_url: 'https://gateway.example.com/custom/v1/',
    });
    expect(parsed.base_url).toBe('https://gateway.example.com/custom/v1');
  });

  it('validates DiscoveredModel', () => {
    const model = DiscoveredModelSchema.parse({
      id: 'gpt-4o',
      name: 'GPT-4o',
      context_window_tokens: 128000,
      max_output_tokens: 4096,
      supports_image_input: true,
      confidence: 'inferred',
    });
    expect(model.id).toBe('gpt-4o');
    expect(model.confidence).toBe('inferred');
  });

  it('validates ModelDiscoveryResponse', () => {
    const response = ModelDiscoveryResponseSchema.parse({
      models: [
        {
          id: 'deepseek-chat',
          name: 'deepseek-chat',
          context_window_tokens: 64000,
          max_output_tokens: 4096,
          supports_image_input: false,
          confidence: 'inferred',
        },
      ],
    });
    expect(response.models).toHaveLength(1);
  });
});
