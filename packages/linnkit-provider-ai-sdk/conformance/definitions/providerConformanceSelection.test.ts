import { describe, expect, it } from 'vitest';
import { createAiSdkLanguageModelRegistry } from '../../src/registry/createAiSdkLanguageModelRegistry';
import { selectAffectedProviderConformance } from './providerConformanceSelection';

const factories = createAiSdkLanguageModelRegistry().entries;

describe('selectAffectedProviderConformance', () => {
  it('升级 OpenAI package 时同时选择 Chat 与 Responses 业务矩阵', () => {
    const selection = selectAffectedProviderConformance({
      factories,
      package_names: ['@ai-sdk/openai'],
    });

    expect(selection.capability_ids).toEqual([
      'ai-sdk:openai-chat',
      'ai-sdk:openai-responses',
    ]);
    expect(selection.test_files).toEqual(
      expect.arrayContaining([
        'conformance/providers/openAiChatCapability.integration.test.ts',
        'conformance/providers/openAiResponsesCodec.integration.test.ts',
        'conformance/providers/providerContinuationRoundTrip.integration.test.ts',
        'conformance/providers/streamReliability.integration.test.ts',
      ])
    );
  });

  it('升级单一正式 Provider 时只选择对应 capability 的局部 conformance', () => {
    expect(
      selectAffectedProviderConformance({
        factories,
        package_names: ['@ai-sdk/deepseek'],
      })
    ).toMatchObject({
      capability_ids: ['ai-sdk:deepseek'],
      test_files: [
        'conformance/providers/contextCompactionRequestCodec.integration.test.ts',
        'conformance/providers/deepSeekProviderCodec.integration.test.ts',
      ],
      provider_packages: [
        { package_name: '@ai-sdk/deepseek', package_version: expect.any(String) },
      ],
    });
  });

  it('升级 Ollama community Provider 时选择原生 Chat conformance', () => {
    expect(
      selectAffectedProviderConformance({
        factories,
        package_names: ['ai-sdk-ollama'],
      })
    ).toMatchObject({
      capability_ids: ['ai-sdk:ollama'],
      test_files: [
        'conformance/providers/contextCompactionRequestCodec.integration.test.ts',
        'conformance/providers/ollamaProviderCodec.integration.test.ts',
      ],
      provider_packages: [
        { package_name: 'ai-sdk-ollama', package_version: expect.any(String) },
      ],
    });
  });

  it('升级 AI SDK Core 时选择全部已注册 capability', () => {
    const selection = selectAffectedProviderConformance({ factories, package_names: ['ai'] });

    expect(selection.capability_ids).toHaveLength(factories.length);
    expect(new Set(selection.capability_ids).size).toBe(factories.length);
  });
});
