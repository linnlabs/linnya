import { describe, expect, it } from 'vitest';
import { buildModelInferenceRoute, type ModelInferenceRoute } from '@app/schemas/model-inference';
import type { ModelConfig } from '../../../definitions/modelCatalog';
import { parseEditableModelPatch } from '../functions/parseEditableModelPatch';

const embeddingRoute = {
  api_surface: 'openai_embeddings',
  capability_id: 'ai-sdk:openai-compatible-embeddings',
  endpoint_id: 'fixture',
  endpoint_model_id: 'provider-model-v2',
  base_url: 'https://fixture.invalid/v2',
  auth_profile: 'bearer',
  usage: { response_usage: 'provider_reported_optional' },
};

const rerankingRoute = {
  api_surface: 'cohere_rerank',
  capability_id: 'ai-sdk:cohere-compatible-reranking',
  endpoint_id: 'fixture',
  endpoint_model_id: 'provider-model-v2',
  base_url: 'https://fixture.invalid/v2',
  auth_profile: 'bearer',
  usage: { response_usage: 'provider_reported_optional' },
};

const documentOcrRoute = {
  api_surface: 'paddle_ocr_jobs',
  capability_id: 'host:paddle-ocr-jobs',
  endpoint_id: 'fixture',
  endpoint_model_id: 'provider-model-v2',
  base_url: 'https://fixture.invalid/v2',
  auth_profile: 'bearer',
  mode: 'document_upload',
  supports_abort_signal: true,
  attempt_timeout_ms: 300_000,
  poll_interval_ms: 5_000,
};

function compatibleModel(admitted: boolean): ModelConfig & { inference_route: ModelInferenceRoute } {
  return {
    id: 'saved-vision-model', model_name: 'verified-model', catalog_source: 'user',
    display_name: 'Vision fixture', description: '', capabilities: ['chat', 'image_input'], ui_visibility: [],
    inference_route: buildModelInferenceRoute({
      profile_id: 'openai_compatible_chat', endpoint_id: 'saved-endpoint',
      endpoint_model_id: 'verified-model', base_url: 'https://fixture.invalid/v1', auth_profile: 'bearer',
      input_support: { user_image: true, tool_result_image: admitted },
      usage: { response_usage: 'provider_reported_optional' }, continuation: { tool_replay: 'optional' },
    }),
  };
}

describe('parseEditableModelPatch - opt-in 图片角色准入', () => {
  it('同身份的显示名/容量编辑保留已有许可，即使通用表单按默认关闭重建 route', () => {
    const model = compatibleModel(true);
    expect(parseEditableModelPatch({
      model_name: model.model_name, display_name: 'Renamed display',
      inference_route: { ...model.inference_route, context_window_tokens: 512_000,
        input_support: { user_image: true, tool_result_image: false } },
    }, model)).toMatchObject({ success: true, patch: {
      display_name: 'Renamed display', inference_route: {
        context_window_tokens: 512_000, input_support: { user_image: true, tool_result_image: true },
      },
    } });
  });

  it('用户请求不能从未准入的 compatible 模型提升工具图片角色', () => {
    const model = compatibleModel(false);
    const patch = { model_name: model.model_name, inference_route: {
      ...model.inference_route, input_support: { user_image: true, tool_result_image: true },
    } };
    expect(parseEditableModelPatch(patch, model)).toMatchObject({ success: false });
    expect(parseEditableModelPatch(patch)).toMatchObject({ success: false });
  });

  it.each([
    { endpoint_id: 'different-endpoint' },
    { endpoint_model_id: 'different-model' },
    { base_url: 'https://different.invalid/v1' },
    { auth_profile: 'none' as const },
  ])('模型/连接身份改变时不能继承旧许可：%j', change => {
    const model = compatibleModel(true);
    const route = { ...model.inference_route, ...change };
    expect(parseEditableModelPatch({ model_name: route.endpoint_model_id, inference_route: route }, model))
      .toMatchObject({ success: false });
    expect(parseEditableModelPatch({ model_name: route.endpoint_model_id, inference_route: {
      ...route, input_support: { user_image: true, tool_result_image: false },
    } }, model)).toMatchObject({ success: true, patch: {
      inference_route: { input_support: { user_image: true, tool_result_image: false } },
    } });
  });

  it('关闭整体视觉会关闭已准入角色，原生支持图片的 profile 仍可正常启用', () => {
    const model = compatibleModel(true);
    expect(parseEditableModelPatch({ model_name: model.model_name, capabilities: ['chat'],
      inference_route: { ...model.inference_route, input_support: { user_image: false, tool_result_image: false } },
    }, model)).toMatchObject({ success: true, patch: {
      inference_route: { input_support: { user_image: false, tool_result_image: false } },
    } });
    expect(parseEditableModelPatch({ model_name: model.model_name, inference_route: {
      ...model.inference_route, api_surface: 'openai_responses', capability_id: 'ai-sdk:openai-responses',
    } }, compatibleModel(false))).toMatchObject({ success: true, patch: {
      inference_route: { input_support: { user_image: true, tool_result_image: true } },
    } });
    const nativeModel: ModelConfig = { ...model, inference_route: {
      ...model.inference_route, api_surface: 'openai_responses', capability_id: 'ai-sdk:openai-responses',
    } };
    expect(parseEditableModelPatch({ model_name: model.model_name, inference_route: model.inference_route }, nativeModel))
      .toMatchObject({ success: false });
  });
});

describe('parseEditableModelPatch - embedding route', () => {
  it('原子接受 model 与 embedding route 身份更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
        embedding_route: embeddingRoute,
      })
    ).toEqual({
      success: true,
      patch: {
        model_name: 'provider-model-v2',
        embedding_route: embeddingRoute,
      },
    });
  });

  it('拒绝不同步 route 的 model 更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
      })
    ).toMatchObject({ success: false });
  });
});

describe('parseEditableModelPatch - reranking route', () => {
  it('原子接受 model 与 reranking route 身份更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
        reranking_route: rerankingRoute,
      })
    ).toEqual({
      success: true,
      patch: {
        model_name: 'provider-model-v2',
        reranking_route: rerankingRoute,
      },
    });
  });
});

describe('parseEditableModelPatch - document OCR route', () => {
  it('原子接受 model 与 document OCR route 身份更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
        document_ocr_route: documentOcrRoute,
      })
    ).toEqual({
      success: true,
      patch: {
        model_name: 'provider-model-v2',
        document_ocr_route: documentOcrRoute,
      },
    });
  });
});
