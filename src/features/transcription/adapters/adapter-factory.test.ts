import { describe, expect, it } from 'vitest';
import { createTranscriptionAdapter } from './adapter-factory';
import { QwenASRAdapter } from './qwen-asr-adapter';
import { WhisperAdapter } from './whisper-adapter';
import type { ResolvedTranscriptionModel } from './types';

function openAiModel(): ResolvedTranscriptionModel {
  return {
    id: 'asr-model',
    credential: 'secret',
    route: {
      api_surface: 'openai_audio_transcriptions',
      capability_id: 'host:openai-audio-transcriptions',
      endpoint_id: 'provider',
      endpoint_model_id: 'provider-model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
    },
  };
}

describe('ASRAdapterFactory', () => {
  it('只按 typed capability 选择协议实现', () => {
    expect(createTranscriptionAdapter(openAiModel())).toBeInstanceOf(WhisperAdapter);
    expect(createTranscriptionAdapter({
      ...openAiModel(),
      route: {
        api_surface: 'dashscope_multimodal_generation',
        capability_id: 'host:dashscope-qwen-asr',
        endpoint_id: 'dashscope',
        endpoint_model_id: 'qwen3-asr-flash',
        base_url: 'https://dashscope.aliyuncs.com/api/v1',
        auth_profile: 'bearer',
      },
    })).toBeInstanceOf(QwenASRAdapter);
  });
});
