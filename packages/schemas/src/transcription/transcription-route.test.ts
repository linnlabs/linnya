import { describe, expect, it } from 'vitest';

import {
  TRANSCRIPTION_CAPABILITY_IDS,
  TranscriptionRouteSchema,
  parseTranscriptionRoute,
} from './transcription-route';

describe('TranscriptionRouteSchema', () => {
  it('接纳 OpenAI Audio Transcriptions route，并规范化 base URL', () => {
    expect(parseTranscriptionRoute({
      api_surface: 'openai_audio_transcriptions',
      capability_id: TRANSCRIPTION_CAPABILITY_IDS.OPENAI_AUDIO_TRANSCRIPTIONS,
      endpoint_id: 'feiai',
      endpoint_model_id: 'whisper-1',
      base_url: 'https://feiai.chat/v1/',
      auth_profile: 'bearer',
    })).toEqual({
      api_surface: 'openai_audio_transcriptions',
      capability_id: 'host:openai-audio-transcriptions',
      endpoint_id: 'feiai',
      endpoint_model_id: 'whisper-1',
      base_url: 'https://feiai.chat/v1',
      auth_profile: 'bearer',
    });
  });

  it('拒绝 surface、capability 与认证合同错配', () => {
    expect(TranscriptionRouteSchema.safeParse({
      api_surface: 'dashscope_multimodal_generation',
      capability_id: TRANSCRIPTION_CAPABILITY_IDS.OPENAI_AUDIO_TRANSCRIPTIONS,
      endpoint_id: 'dashscope',
      endpoint_model_id: 'qwen3-asr-flash',
      base_url: 'https://dashscope.aliyuncs.com/api/v1',
      auth_profile: 'api_key',
    }).success).toBe(false);
  });
});
