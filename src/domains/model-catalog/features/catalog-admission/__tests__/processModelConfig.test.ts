/**
 * @file model-config-processor.test.ts
 *
 * @description 测试 processModelConfig() 的显式 route 与能力配置行为。
 */

import { describe, expect, it } from 'vitest';
import { processModelConfig } from '../functions/processModelConfig';

/** 构造一个满足所有必需字段的最小 modelData */
function makeModelData(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-model',
    model_name: 'test-model',
    catalog_source: 'user',
    credential_reference: { kind: 'environment_variable', environment_variable: 'TEST_API_KEY' },
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    display_name: '测试模型',
    description: '',
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'openai',
      endpoint_model_id: 'test-model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 16_384,
      max_output_tokens: 4_096,
      input_support: {
        user_image: false,
        tool_result_image: false,
      },
      usage: {
        response_usage: 'provider_reported_optional',
      },
      continuation: {
        tool_replay: 'optional',
      },
    },
    ...overrides,
  };
}

describe('processModelConfig - inference_route', () => {
  it('拒绝旧明文与环境变量字段进入 ModelConfig', () => {
    expect(() => processModelConfig({
      modelData: makeModelData({ api_key: 'secret' }),
      envVars: {},
    })).toThrow(/不再接受 api_key/);
  });

  it('chat 模型必须提供完整显式 route', () => {
    expect(() =>
      processModelConfig({
        modelData: makeModelData({ inference_route: undefined }),
        envVars: {},
      })
    ).toThrow(/chat 模型必须声明 inference_route/);
  });

  it('route 应保留 surface、能力绑定、上下文和图片 placement', () => {
    const result = processModelConfig({
      modelData: makeModelData(),
      envVars: {},
    });

    expect(result.inference_route).toEqual({
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'openai',
      endpoint_model_id: 'test-model',
      base_url: 'https://example.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 16_384,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    });
  });

  it('route provider model 与模型目录不一致时拒绝启用', () => {
    expect(() =>
      processModelConfig({
        modelData: makeModelData({
          inference_route: {
            ...makeModelData().inference_route,
            endpoint_model_id: 'different-model',
          },
        }),
        envVars: {},
      })
    ).toThrow(/endpoint_model_id 必须与 model_name 一致/);
  });

  it('route token 上限必须是正安全整数', () => {
    expect(() =>
      processModelConfig({
        modelData: makeModelData({
          inference_route: {
            ...makeModelData().inference_route,
            max_output_tokens: 0,
          },
        }),
        envVars: {},
      })
    ).toThrow(/max_output_tokens.*必须是正安全整数/);
  });
});

describe('processModelConfig - document_ocr_route', () => {
  it('应解析 layout route，并由 typed route 独占专用端点', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        id: 'PaddlePaddle/PaddleOCR-VL-1.5',
        model_name: 'PaddlePaddle/PaddleOCR-VL-1.5',
        catalog_source: 'default',
        capabilities: ['vision', 'document_ocr'],
        inference_route: undefined,
        document_ocr_route: {
          api_surface: 'paddle_layout_parsing',
          capability_id: 'host:paddle-ocr-layout-parsing',
          endpoint_id: 'paddleocr',
          endpoint_model_id: 'PaddlePaddle/PaddleOCR-VL-1.5',
          base_url: 'https://example.test/layout-parsing',
          auth_profile: 'token',
          mode: 'document_upload',
          supports_abort_signal: true,
          attempt_timeout_ms: 300_000,
          max_input_pages: 100,
        },
      }),
      envVars: {},
    });

    expect(result.document_ocr_route).toEqual({
      api_surface: 'paddle_layout_parsing',
      capability_id: 'host:paddle-ocr-layout-parsing',
      endpoint_id: 'paddleocr',
      endpoint_model_id: 'PaddlePaddle/PaddleOCR-VL-1.5',
      base_url: 'https://example.test/layout-parsing',
      auth_profile: 'token',
      mode: 'document_upload',
      supports_abort_signal: true,
      attempt_timeout_ms: 300_000,
      max_input_pages: 100,
    });
  });

  it('document_ocr capability 缺少 route 时拒绝启用', () => {
    expect(() =>
      processModelConfig({
        modelData: makeModelData({
          capabilities: ['vision', 'document_ocr'],
          inference_route: undefined,
        }),
        envVars: {},
      })
    ).toThrow(/document_ocr 模型必须声明 document_ocr_route/);
  });

  it('非 document_ocr 模型不能夹带专用 route', () => {
    expect(() =>
      processModelConfig({
        modelData: makeModelData({
          document_ocr_route: {
            api_surface: 'paddle_ocr_jobs',
            capability_id: 'host:paddle-ocr-jobs',
            endpoint_id: 'paddleocr',
            endpoint_model_id: 'test-model',
            base_url: 'https://example.com/v1',
            auth_profile: 'bearer',
            mode: 'document_upload',
            supports_abort_signal: true,
            attempt_timeout_ms: 300_000,
            poll_interval_ms: 5_000,
          },
        }),
        envVars: {},
      })
    ).toThrow(/只有声明 document_ocr capability/);
  });
});

describe('processModelConfig - image_generation_route', () => {
  const imageRoute = {
    api_surface: 'openai_images_generations',
    capability_id: 'ai-sdk:openai-compatible-image-generation',
    endpoint_id: 'volcengine',
    endpoint_model_id: 'seedream-model',
    base_url: 'https://provider.example/api/v3',
    auth_profile: 'bearer',
    response_format: 'b64_json',
    max_images_per_call: 1,
  } as const;

  it('保留 typed image route 和 Provider 原生尺寸约束', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        id: 'seedream-model',
        model_name: 'seedream-model',
        capabilities: ['image_generation'],
        inference_route: undefined,
        image_generation_route: imageRoute,
        image_generation: {
          min_pixels: 3_686_400,
          allowed_sizes: ['2K', '2048x2048'],
        },
      }),
      envVars: {},
    });

    expect(result.image_generation_route).toEqual(imageRoute);
    expect(result.image_generation?.allowed_sizes).toEqual(['2K', '2048x2048']);
  });

  it('image_generation capability 缺少 route 时拒绝启用', () => {
    expect(() => processModelConfig({
      modelData: makeModelData({
        capabilities: ['image_generation'],
        inference_route: undefined,
      }),
      envVars: {},
    })).toThrow(/image_generation 模型必须声明 image_generation_route/);
  });
});

describe('processModelConfig - transcription_route', () => {
  it('应解析专用 ASR route', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        id: 'qwen3-asr-flash',
        model_name: 'qwen3-asr-flash',
        catalog_source: 'default',
        capabilities: ['audio_transcription'],
        inference_route: undefined,
        transcription_route: {
          api_surface: 'dashscope_multimodal_generation',
          capability_id: 'host:dashscope-qwen-asr',
          endpoint_id: 'dashscope',
          endpoint_model_id: 'qwen3-asr-flash',
          base_url: 'https://dashscope.aliyuncs.com/api/v1',
          auth_profile: 'bearer',
        },
      }),
      envVars: {},
    });

    expect(result.transcription_route?.capability_id).toBe('host:dashscope-qwen-asr');
  });

  it('audio_transcription capability 缺少 typed route 时拒绝启用', () => {
    expect(() => processModelConfig({
      modelData: makeModelData({
        capabilities: ['audio_transcription'],
        inference_route: undefined,
      }),
      envVars: {},
    })).toThrow(/audio_transcription 模型必须声明 transcription_route/);
  });

  it('route model identity 与目录不一致时拒绝准入', () => {
    expect(() => processModelConfig({
      modelData: makeModelData({
        capabilities: ['audio_transcription'],
        inference_route: undefined,
        transcription_route: {
          api_surface: 'openai_audio_transcriptions',
          capability_id: 'host:openai-audio-transcriptions',
          endpoint_id: 'openai',
          endpoint_model_id: 'other-model',
          base_url: 'https://example.com/v1',
          auth_profile: 'bearer',
        },
      }),
      envVars: {},
    })).toThrow(/transcription_route.endpoint_model_id 必须与 model_name 一致/);
  });
});

describe('processModelConfig - token route / pricing', () => {
  it('应保留显式声明的 token_route，不按 provider/model_name 推断能力', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        token_route: {
          capabilityId: 'openrouter',
          baseURL: 'https://openrouter.ai/api/v1',
          modelId: 'host-gemini',
          endpointModelId: 'google/gemini-3-pro',
          capabilities: {
            supportsResponseUsage: true,
            supportsRemoteTokenCount: false,
          },
        },
      }),
      envVars: {},
    });

    expect(result.token_route).toEqual({
      capabilityId: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      modelId: 'host-gemini',
      endpointModelId: 'google/gemini-3-pro',
      capabilities: {
        supportsResponseUsage: true,
        supportsRemoteTokenCount: false,
      },
    });
  });

  it('token_pricing 应只接受已解析好的 USD / per_1m_tokens 有效单价', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        token_pricing: {
          currency: 'USD',
          unit: 'per_1m_tokens',
          input: 0.15,
          output: 0.6,
          cacheRead: 0.03,
        },
      }),
      envVars: {},
    });

    expect(result.token_pricing).toEqual({
      currency: 'USD',
      unit: 'per_1m_tokens',
      input: 0.15,
      output: 0.6,
      reasoning: undefined,
      cacheRead: 0.03,
      cacheWrite: undefined,
    });
  });

  it('token_route 缺少必需字段时应报错，不静默构造半截 route', () => {
    expect(() =>
      processModelConfig({
        modelData: makeModelData({
          token_route: {
            capabilityId: 'openai',
          },
        }),
        envVars: {},
      })
    ).toThrowError(/token_route/);
  });
});

describe('processModelConfig - reasoning 字段校验', () => {
  it('合法 reasoning 契约应原样保留', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        reasoning: {
          supported_efforts: ['off', 'low', 'medium', 'high'],
          default_effort: 'medium',
        },
      }),
      envVars: {},
    });

    expect(result.reasoning).toEqual({
      supported_efforts: ['off', 'low', 'medium', 'high'],
      default_effort: 'medium',
    });
  });

  it('supported_efforts 应过滤非法枚举值', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        reasoning: {
          supported_efforts: ['low', 'turbo', 'medium', 123],
          default_effort: 'low',
        },
      }),
      envVars: {},
    });

    expect(result.reasoning?.supported_efforts).toEqual(['low', 'medium']);
  });

  it('supported_efforts 应去重并按从弱到强顺序归一化排序', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        reasoning: {
          supported_efforts: ['high', 'low', 'high', 'medium', 'low'],
        },
      }),
      envVars: {},
    });

    expect(result.reasoning?.supported_efforts).toEqual(['low', 'medium', 'high']);
  });

  it('supported_efforts 为空数组 → 视为不支持，reasoning 字段不保留', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        reasoning: {
          supported_efforts: [],
        },
      }),
      envVars: {},
    });

    expect(result.reasoning).toBeUndefined();
  });

  it('default_effort 不在 supported_efforts 中 → 忽略', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        reasoning: {
          supported_efforts: ['low', 'medium'],
          default_effort: 'xhigh',
        },
      }),
      envVars: {},
    });

    expect(result.reasoning?.default_effort).toBeUndefined();
  });

  it('未配置 reasoning → 字段为 undefined', () => {
    const result = processModelConfig({
      modelData: makeModelData(),
      envVars: {},
    });

    expect(result.reasoning).toBeUndefined();
  });

  it('gpt-6-astra 未显式保存 reasoning 时仍按模型能力补齐契约', () => {
    const result = processModelConfig({
      modelData: makeModelData({
        model_name: 'gpt-6-astra',
        inference_route: {
          ...makeModelData().inference_route,
          endpoint_model_id: 'gpt-6-astra',
        },
      }),
      envVars: {},
    });

    expect(result.reasoning).toEqual({
      supported_efforts: ['low', 'medium', 'high', 'xhigh'],
      default_effort: 'medium',
    });
  });
});
