import { describe, expect, it } from 'vitest';
import { projectLiveProviderModelMetadata } from '../../../index';
import { ModelsDevProviderSchema } from '../definitions/modelsDevSource';
import { PROVIDER_ADMISSION_POLICIES } from '../registry/providerAdmissionPolicies';
import { projectModelsDevProviderModels } from './projectModelsDevProviderModels';

function model(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    tool_call: true,
    reasoning: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 256_000, input: 300_000, output: 16_384 },
    ...overrides,
  };
}

function provider(id: string, models: Record<string, unknown>) {
  return {
    id,
    name: id,
    npm: '@ai-sdk/openai-compatible',
    api: `https://api.${id}.example/v1`,
    models,
  };
}

describe('projectLiveProviderModelMetadata', () => {
  it('投影新 ID 的能力容量，隔离无关供应商脏数据且不泄露上游配置', () => {
    const metadata = projectLiveProviderModelMetadata('ollama-cloud', {
      'ollama-cloud': provider('ollama-cloud', {
        'new-flash': model('new-flash', { env: ['PRIVATE_TOKEN'], extra: 'untrusted' }),
      }),
      deepseek: { models: 'invalid-unrelated-provider' },
    });

    expect(metadata).toEqual([
      {
        id: 'new-flash',
        display_name: 'new-flash',
        release_status: 'active',
        context_window_tokens: 256_000,
        max_input_tokens: 256_000,
        max_output_tokens: 16_384,
        capabilities: { image_input: true, tool_call: true, reasoning: true },
      },
    ]);
  });

  it('过滤弃用、非文本和零容量的语言模型资料', () => {
    const metadata = projectLiveProviderModelMetadata('ollama-cloud', {
      'ollama-cloud': provider('ollama-cloud', {
        current: model('current', { status: 'beta' }),
        early: model('early', { status: 'alpha' }),
        retired: model('retired', { status: 'deprecated' }),
        image: model('image', { modalities: { output: ['image'] } }),
        zero: model('zero', { limit: { context: 0, output: 0 } }),
      }),
    });

    expect(metadata.map(candidate => candidate.id)).toEqual(['current', 'early']);
    expect(metadata.map(candidate => candidate.release_status)).toEqual(['preview', 'preview']);
  });

  it('上游未声明工具能力时仍提供补充容量，但静态目录继续拒绝这些模型', () => {
    const sourceProvider = provider('ollama-cloud', {
      'tools-unlisted': model('tools-unlisted', { tool_call: false }),
      'tools-unspecified': model('tools-unspecified', { tool_call: undefined }),
    });
    const metadata = projectLiveProviderModelMetadata('ollama-cloud', {
      'ollama-cloud': sourceProvider,
    });

    // 官方 /api/show 决定工具能力；metadata 保留来源值，只确保精确 ID 的容量可供补充。
    expect(
      metadata.map(candidate => ({
        id: candidate.id,
        output: candidate.max_output_tokens,
        observedToolCall: candidate.capabilities.tool_call,
      }))
    ).toEqual([
      { id: 'tools-unlisted', output: 16_384, observedToolCall: false },
      { id: 'tools-unspecified', output: 16_384, observedToolCall: false },
    ]);
    const policy = PROVIDER_ADMISSION_POLICIES.find(
      candidate => candidate.provider_connection_definition_id === 'ollama-cloud'
    );
    if (!policy) throw new Error('Ollama Cloud policy is required for this business scenario');
    expect(
      projectModelsDevProviderModels(ModelsDevProviderSchema.parse(sourceProvider), policy)
    ).toEqual([]);
  });

  it('按 connection 的 source policy 取资料，不要求其他历史绑定模型仍存在', () => {
    const metadata = projectLiveProviderModelMetadata('opencode-go', {
      'opencode-go': provider('opencode-go', {
        'grok-4.7': model('grok-4.7', { provider: { npm: '@ai-sdk/openai' } }),
      }),
    });
    expect(metadata.map(candidate => candidate.id)).toEqual(['grok-4.7']);

    expect(
      projectLiveProviderModelMetadata('moonshot-api-cn', {
        moonshotai: provider('moonshotai', { 'new-kimi': model('new-kimi') }),
      }).map(candidate => candidate.id)
    ).toEqual(['new-kimi']);
  });

  it('未审核的模型 provider override 不能通过实时资料查询进入默认协议', () => {
    expect(projectLiveProviderModelMetadata('opencode-go', {
      'opencode-go': provider('opencode-go', {
        'gemini-4-argon-contributor': model('gemini-4-argon-contributor', {
          provider: { npm: '@ai-sdk/google' },
        }),
      }),
    })).toEqual([]);
    expect(() =>
      projectLiveProviderModelMetadata('opencode-go', {
        'opencode-go': provider('opencode-go', {
          'new-model': model('new-model', {
            tool_call: false,
            provider: { npm: '@ai-sdk/anthropic' },
          }),
        }),
      })
    ).toThrow(/provider 覆盖缺少已审查 route: new-model/);
  });

  it('明确拒绝未知或没有 models.dev 来源的 connection，以及缺失的目标资料', () => {
    expect(() => projectLiveProviderModelMetadata('unknown', {})).toThrow(/未知 connection/);
    expect(() => projectLiveProviderModelMetadata('ollama', {})).toThrow(/没有 models.dev/);
    expect(() => projectLiveProviderModelMetadata('deepseek', {})).toThrow(
      /缺少已准入 Provider: deepseek/
    );
    expect(() =>
      projectLiveProviderModelMetadata('deepseek', { deepseek: { models: 'invalid' } })
    ).toThrow();
  });

  it('拒绝目标 provider 和 model 的 key/id 分叉及非法关键容量', () => {
    expect(() =>
      projectLiveProviderModelMetadata('deepseek', {
        deepseek: provider('different-provider', {}),
      })
    ).toThrow(/Provider key\/id 不一致/);
    expect(() =>
      projectLiveProviderModelMetadata('deepseek', {
        deepseek: provider('deepseek', { wrong: model('different-model') }),
      })
    ).toThrow(/Model key\/id 不一致/);
    expect(() =>
      projectLiveProviderModelMetadata('deepseek', {
        deepseek: provider('deepseek', { broken: model('broken', { limit: { context: 100 } }) }),
      })
    ).toThrow();
  });
});
