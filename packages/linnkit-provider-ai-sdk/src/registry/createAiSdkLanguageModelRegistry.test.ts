import { describe, expect, it, vi } from 'vitest';
import { AI_SDK_INFERENCE_CAPABILITY_IDS } from '../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryInput } from '../definitions/aiSdkInferenceSurface';
import { createAiSdkLanguageModelRegistry } from './createAiSdkLanguageModelRegistry';

function factoryInput(
  overrides: Partial<AiSdkLanguageModelFactoryInput> = {}
): AiSdkLanguageModelFactoryInput {
  return {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.DEEPSEEK_CHAT,
    surface: 'openai_chat_completions',
    endpoint_id: 'deepseek',
    endpoint_model_id: 'deepseek-v4-pro',
    base_url: 'https://example.com/deepseek',
    credential: { profile: 'bearer', secret: 'fixture-secret' },
    ...overrides,
  };
}

describe('createAiSdkLanguageModelRegistry', () => {
  it('每个正式 capability 都有且只有一个第三方 package factory', () => {
    const registry = createAiSdkLanguageModelRegistry();
    const registeredCapabilityIds = registry.entries.map(entry => entry.capability_id);

    expect(new Set(registeredCapabilityIds)).toEqual(
      new Set(Object.values(AI_SDK_INFERENCE_CAPABILITY_IDS))
    );
    expect(registeredCapabilityIds).toHaveLength(new Set(registeredCapabilityIds).size);
    expect(registry.entries.every(entry => /^\d+\.\d+\.\d+/.test(entry.package_version))).toBe(
      true
    );
  });

  it('DeepSeek、MiniMax 与 Z.AI 使用各自正式 Provider V4 factory', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const registry = createAiSdkLanguageModelRegistry(fetch);

    const deepseek = registry.languageModel(factoryInput());
    const minimax = registry.languageModel(
      factoryInput({
        capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.MINIMAX_CHAT,
        surface: 'anthropic_messages',
        endpoint_id: 'minimax',
        endpoint_model_id: 'minimax-m2.7',
        base_url: 'https://example.com/minimax/anthropic/v1',
        credential: { profile: 'api_key', secret: 'fixture-secret' },
      })
    );
    const zai = registry.languageModel(
      factoryInput({
        capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.ZAI_CHAT,
        endpoint_id: 'zai',
        endpoint_model_id: 'glm-5.3',
        base_url: 'https://api.z.ai/api/paas/v4',
      })
    );

    expect(deepseek.specificationVersion).toBe('v4');
    expect(deepseek.provider).toContain('deepseek');
    expect(deepseek.modelId).toBe('deepseek-v4-pro');
    expect(minimax.specificationVersion).toBe('v4');
    expect(minimax.provider).toContain('minimax');
    expect(minimax.modelId).toBe('minimax-m2.7');
    expect(zai.specificationVersion).toBe('v4');
    expect(zai.provider).toContain('zai');
    expect(zai.modelId).toBe('glm-5.3');
  });

  it('在创建模型前拒绝 capability/surface 或 credential profile 错配', () => {
    const registry = createAiSdkLanguageModelRegistry();

    expect(() =>
      registry.languageModel(
        factoryInput({
          surface: 'anthropic_messages',
        })
      )
    ).toThrow(/capability 与 anthropic_messages surface 不一致/);

    expect(() =>
      registry.languageModel(
        factoryInput({
          credential: { profile: 'api_key', secret: 'fixture-secret' },
        })
      )
    ).toThrow(/不接受 api_key 凭据/);
  });
});
