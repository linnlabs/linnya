import { describe, expect, it } from 'vitest';

import type {
  OllamaModelRegistrationCommand,
  OllamaModelRegistrationResponse,
} from '@app/schemas/ollama-onboarding';
import type { OllamaModelRegistrationGateway } from '../definitions/ollamaModelRegistrationGateway';
import { registerOllamaModel } from './registerOllamaModel';

function recordingGateway(
  commands: OllamaModelRegistrationCommand[]
): OllamaModelRegistrationGateway {
  return {
    async register(command): Promise<OllamaModelRegistrationResponse> {
      commands.push(command);
      return {
        model_id: 'model-1',
        provider_definition_id: 'ollama',
        provider_connection_definition_id: command.provider_connection_definition_id,
        provider_model_id: command.endpoint_model_id,
      };
    },
  };
}

describe('registerOllamaModel', () => {
  it('只提交用户可理解的 Ollama 事实，不在 Renderer 构造 route/endpoint', async () => {
    const commands: OllamaModelRegistrationCommand[] = [];
    const result = await registerOllamaModel(
      'ollama',
      {
        endpointModelId: 'qwen3:8b',
        displayName: 'Local Qwen',
        serviceUrl: 'http://localhost:11434/',
        contextWindowTokens: '32768',
        maxOutputTokens: '4096',
      },
      recordingGateway(commands)
    );

    expect(result).toEqual({ ok: true });
    expect(commands[0]).toMatchObject({
      provider_connection_definition_id: 'ollama',
      service_url: 'http://localhost:11434',
      endpoint_model_id: 'qwen3:8b',
      display_name: 'Local Qwen',
      context_window_tokens: 32768,
      max_output_tokens: 4096,
    });
  });

  it('容量非法时不触发目录注册', async () => {
    const commands: OllamaModelRegistrationCommand[] = [];
    await expect(
      registerOllamaModel(
        'ollama',
        {
          endpointModelId: 'qwen3:8b',
          displayName: '',
          serviceUrl: 'http://localhost:11434',
          contextWindowTokens: '0',
          maxOutputTokens: '4096',
        },
        recordingGateway(commands)
      )
    ).resolves.toEqual({ ok: false, issue: 'token_limits_invalid' });
    expect(commands).toEqual([]);
  });
});
