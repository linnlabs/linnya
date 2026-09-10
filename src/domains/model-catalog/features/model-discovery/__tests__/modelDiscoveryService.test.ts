import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryUrl,
  parseModelListingResponse,
  ModelDiscoveryService,
} from '../modelDiscoveryService';

describe('ModelDiscoveryService', () => {
  describe('buildDiscoveryUrl', () => {
    it('builds /models for openai_compatible', () => {
      expect(buildDiscoveryUrl('https://api.openai.com/v1', 'openai_compatible')).toBe(
        'https://api.openai.com/v1/models',
      );
      expect(buildDiscoveryUrl('https://api.openai.com/v1/models', 'openai_compatible')).toBe(
        'https://api.openai.com/v1/models',
      );
    });

    it('builds /v1/models for anthropic_compatible', () => {
      expect(buildDiscoveryUrl('https://api.anthropic.com/v1', 'anthropic_compatible')).toBe(
        'https://api.anthropic.com/v1/models?limit=1000',
      );
      expect(buildDiscoveryUrl('https://api.anthropic.com', 'anthropic_compatible')).toBe(
        'https://api.anthropic.com/v1/models?limit=1000',
      );
    });
  });

  describe('parseModelListingResponse', () => {
    it('parses standard OpenAI format with inferred capabilities', () => {
      const data = {
        data: [
          { id: 'gpt-4o', created: 123456 },
          { id: 'deepseek-chat', created: 123456 },
        ],
      };
      const models = parseModelListingResponse(data);
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'gpt-4o',
        name: 'gpt-4o',
        context_window_tokens: 128000,
        max_output_tokens: 4096,
        supports_image_input: true,
        confidence: 'inferred',
      });
      expect(models[1]).toMatchObject({
        id: 'deepseek-chat',
        name: 'deepseek-chat',
        context_window_tokens: 64000,
        supports_image_input: false,
        confidence: 'inferred',
      });
    });

    it('prefers reported capabilities when present', () => {
      const data = {
        data: [
          {
            id: 'custom-model',
            display_name: 'Custom Model',
            context_window: 256000,
            max_output_tokens: 16384,
            supports_image_input: true,
          },
        ],
      };
      const models = parseModelListingResponse(data);
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'custom-model',
        name: 'Custom Model',
        context_window_tokens: 256000,
        max_output_tokens: 16384,
        supports_image_input: true,
        confidence: 'reported',
      });
    });

    it('parses enriched map format (OpenRouter style)', () => {
      const data = {
        models: {
          'meta-llama/llama-3.3-70b-instruct': {
            name: 'Llama 3.3 70B',
            context_length: 131072,
            top_provider: {
              max_completion_tokens: 8192,
            },
          },
        },
      };
      const models = parseModelListingResponse(data);
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('meta-llama/llama-3.3-70b-instruct');
      expect(models[0].name).toBe('Llama 3.3 70B');
      expect(models[0].context_window_tokens).toBe(131072);
      expect(models[0].max_output_tokens).toBe(8192);
      expect(models[0].confidence).toBe('reported');
    });
  });

  describe('ModelDiscoveryService discover', () => {
    it('handles network success and builds correct headers', async () => {
      let requestedUrl = '';
      let requestedHeaders: Record<string, string> = {};

      const mockFetch: typeof fetch = async (url, init) => {
        requestedUrl = String(url);
        requestedHeaders = (init?.headers as Record<string, string>) ?? {};
        return new Response(
          JSON.stringify({
            data: [{ id: 'gpt-4o' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const service = new ModelDiscoveryService({ fetchFn: mockFetch });
      const result = await service.discover({
        api_format: 'openai_compatible',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-test',
      });

      expect(requestedUrl).toBe('https://api.openai.com/v1/models');
      expect(requestedHeaders['Authorization']).toBe('Bearer sk-test');
      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('gpt-4o');
    });

    it('throws auth_failed on 401 response', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Unauthorized', { status: 401 });
      };

      const service = new ModelDiscoveryService({ fetchFn: mockFetch });
      await expect(
        service.discover({
          api_format: 'openai_compatible',
          base_url: 'https://api.openai.com/v1',
          api_key: 'invalid-key',
        }),
      ).rejects.toMatchObject({
        code: 'model_discovery.auth_failed',
        statusCode: 401,
      });
    });
  });
});
