import { describe, expect, it } from 'vitest';

import {
  missingByokLiveSmokeEnvironmentVariables,
  readByokLiveSmokeConfiguration,
} from './readByokLiveSmokeConfiguration';

const completeEnvironment: NodeJS.ProcessEnv = {
  LINNYA_BYOK_TARGETS: 'all',
  LINNYA_BYOK_OPENAI_API_KEY: 'openai-secret',
  LINNYA_BYOK_OPENAI_CHAT_MODEL: 'chat-model',
  LINNYA_BYOK_OPENAI_RESPONSES_MODEL: 'responses-model',
  LINNYA_BYOK_CHATGPT_API_KEY: 'chatgpt-access-token',
  LINNYA_BYOK_CHATGPT_MODEL: 'gpt-5.4',
  LINNYA_BYOK_OPENCODE_GO_API_KEY: 'opencode-go-secret',
  LINNYA_BYOK_OPENCODE_GO_OPENAI_COMPATIBLE_CHAT_MODEL: 'glm-5.3',
  LINNYA_BYOK_OPENCODE_GO_OPENAI_RESPONSES_MODEL: 'gpt-5.6-luna',
  LINNYA_BYOK_OPENCODE_GO_ANTHROPIC_MESSAGES_MODEL: 'qwen3.8-max',
  LINNYA_BYOK_ANTHROPIC_API_KEY: 'anthropic-secret',
  LINNYA_BYOK_ANTHROPIC_MODEL: 'anthropic-model',
  LINNYA_BYOK_GOOGLE_API_KEY: 'google-secret',
  LINNYA_BYOK_GOOGLE_MODEL: 'google-model',
  LINNYA_BYOK_DEEPSEEK_API_KEY: 'deepseek-secret',
  LINNYA_BYOK_DEEPSEEK_MODEL: 'deepseek-model',
  LINNYA_BYOK_MINIMAX_API_KEY: 'minimax-secret',
  LINNYA_BYOK_MINIMAX_MODEL: 'minimax-model',
  LINNYA_BYOK_MOONSHOTAI_API_KEY: 'moonshot-global-secret',
  LINNYA_BYOK_MOONSHOTAI_MODEL: 'moonshot-global-model',
  LINNYA_BYOK_MOONSHOTAI_CN_API_KEY: 'moonshot-cn-secret',
  LINNYA_BYOK_MOONSHOTAI_CN_MODEL: 'moonshot-cn-model',
  LINNYA_BYOK_KIMI_CODE_API_KEY: 'kimi-code-secret',
  LINNYA_BYOK_KIMI_CODE_MODEL: 'kimi-code-model',
  LINNYA_BYOK_ALIBABA_API_KEY: 'alibaba-secret',
  LINNYA_BYOK_ALIBABA_MODEL: 'alibaba-model',
  LINNYA_BYOK_MISTRAL_API_KEY: 'mistral-secret',
  LINNYA_BYOK_MISTRAL_MODEL: 'mistral-model',
  LINNYA_BYOK_XAI_API_KEY: 'xai-secret',
  LINNYA_BYOK_XAI_MODEL: 'xai-model',
  LINNYA_BYOK_GROQ_API_KEY: 'groq-secret',
  LINNYA_BYOK_GROQ_MODEL: 'groq-model',
  LINNYA_BYOK_CEREBRAS_API_KEY: 'cerebras-secret',
  LINNYA_BYOK_CEREBRAS_MODEL: 'cerebras-model',
  LINNYA_BYOK_OPENROUTER_API_KEY: 'openrouter-secret',
  LINNYA_BYOK_OPENROUTER_MODEL: 'openrouter-model',
  LINNYA_BYOK_FIREWORKS_API_KEY: 'fireworks-secret',
  LINNYA_BYOK_FIREWORKS_MODEL: 'fireworks-model',
  LINNYA_BYOK_TOGETHERAI_API_KEY: 'togetherai-secret',
  LINNYA_BYOK_TOGETHERAI_MODEL: 'togetherai-model',
  LINNYA_BYOK_DEEPINFRA_API_KEY: 'deepinfra-secret',
  LINNYA_BYOK_DEEPINFRA_MODEL: 'deepinfra-model',
  LINNYA_BYOK_COHERE_API_KEY: 'cohere-secret',
  LINNYA_BYOK_COHERE_MODEL: 'cohere-model',
  LINNYA_BYOK_SILICONFLOW_API_KEY: 'siliconflow-secret',
  LINNYA_BYOK_SILICONFLOW_MODEL: 'siliconflow-model',
  LINNYA_BYOK_SILICONFLOW_CN_API_KEY: 'siliconflow-cn-secret',
  LINNYA_BYOK_SILICONFLOW_CN_MODEL: 'siliconflow-cn-model',
  LINNYA_BYOK_ZAI_API_KEY: 'zai-secret',
  LINNYA_BYOK_ZAI_MODEL: 'zai-model',
  LINNYA_BYOK_ZHIPU_CN_API_KEY: 'zhipu-cn-secret',
  LINNYA_BYOK_ZHIPU_CN_MODEL: 'zhipu-cn-model',
  LINNYA_BYOK_GLM_CODING_PLAN_API_KEY: 'glm-coding-plan-secret',
  LINNYA_BYOK_GLM_CODING_PLAN_MODEL: 'glm-coding-plan-model',
  LINNYA_BYOK_NVIDIA_API_KEY: 'nvidia-secret',
  LINNYA_BYOK_NVIDIA_MODEL: 'nvidia-model',
  LINNYA_BYOK_MODELSCOPE_API_KEY: 'modelscope-secret',
  LINNYA_BYOK_MODELSCOPE_MODEL: 'modelscope-model',
};

describe('BYOK live smoke configuration', () => {
  it('只要求所选 target 的专用凭据，可独立验证 DeepSeek', () => {
    const configuration = readByokLiveSmokeConfiguration({
      LINNYA_BYOK_TARGETS: 'deepseek',
      LINNYA_BYOK_DEEPSEEK_API_KEY: 'deepseek-secret',
      LINNYA_BYOK_DEEPSEEK_MODEL: 'deepseek-reasoner',
      OPENAI_API_KEY: 'daily-key-must-not-be-used',
    });

    expect(configuration.targets).toEqual([
      expect.objectContaining({
        id: 'deepseek',
        capability_id: 'ai-sdk:deepseek',
        endpoint_model_id: 'deepseek-reasoner',
        credential: 'deepseek-secret',
      }),
    ]);
  });

  it('all 自动选择 manifest 中全部正式 route target', () => {
    const configuration = readByokLiveSmokeConfiguration(completeEnvironment);
    expect(configuration.targets.map(target => target.id)).toEqual([
      'openai-responses',
      'openai-chat',
      'chatgpt',
      'opencode-go-openai-compatible-chat',
      'opencode-go-openai-responses',
      'opencode-go-anthropic-messages',
      'anthropic',
      'google',
      'deepseek',
      'moonshotai',
      'moonshotai-cn',
      'kimi-code',
      'alibaba',
      'minimax',
      'mistral',
      'xai',
      'groq',
      'cerebras',
      'openrouter',
      'fireworks',
      'togetherai',
      'deepinfra',
      'cohere',
      'siliconflow',
      'siliconflow-cn',
      'zai',
      'zhipu-cn',
      'glm-coding-plan',
      'nvidia',
      'modelscope',
    ]);
  });

  it('缺失时只报告当前 target 需要的变量名，不输出已有密钥值', () => {
    const environment: NodeJS.ProcessEnv = {
      LINNYA_BYOK_TARGETS: 'moonshotai,alibaba',
      LINNYA_BYOK_MOONSHOTAI_API_KEY: 'must-not-appear',
      LINNYA_BYOK_MOONSHOTAI_MODEL: 'kimi-model',
      LINNYA_BYOK_ALIBABA_API_KEY: 'also-secret',
    };

    expect(missingByokLiveSmokeEnvironmentVariables(environment)).toEqual([
      'LINNYA_BYOK_ALIBABA_MODEL',
    ]);
    expect(() => readByokLiveSmokeConfiguration(environment)).toThrow(
      'BYOK live smoke 缺少环境变量：LINNYA_BYOK_ALIBABA_MODEL'
    );
  });

  it('要求显式 target，并拒绝未知 target', () => {
    expect(missingByokLiveSmokeEnvironmentVariables({})).toEqual(['LINNYA_BYOK_TARGETS']);
    expect(() => readByokLiveSmokeConfiguration({ LINNYA_BYOK_TARGETS: 'glm' })).toThrow(
      /未知 target：glm/
    );
  });
});
