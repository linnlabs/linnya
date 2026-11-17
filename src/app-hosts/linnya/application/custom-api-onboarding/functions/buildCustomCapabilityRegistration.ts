import type { CustomCapabilityModelCommand } from '@app/schemas/custom-api-onboarding';
import { DOCUMENT_OCR_CAPABILITY_IDS } from '@app/schemas/document-ocr';
import {
  EMBEDDING_CAPABILITY_IDS,
  IMAGE_GENERATION_CAPABILITY_IDS,
} from '@app/schemas/model-inference';
import type {
  ModelConfig,
  NewInferenceEndpoint,
  UserModelRegistration,
} from 'src/domains/model-catalog';

/** 每类模型只投影它的真实 route；凭据继续由 Catalog 的 endpoint 事务统一保存。 */
export function buildCustomCapabilityRegistration(
  command: CustomCapabilityModelCommand,
  modelId: string,
  endpointId: string
): UserModelRegistration {
  const model: ModelConfig = {
    id: modelId,
    model_name: command.endpoint_model_id,
    display_name: command.display_name ?? command.endpoint_model_id,
    catalog_source: 'user',
    custom_provider_name: command.provider_name,
    capabilities: [],
    ui_visibility: [],
    description: '用户通过自定义 API 添加的模型',
    billing_mode: 'byok',
  };
  const route = {
    endpoint_id: `custom:${endpointId}`,
    endpoint_model_id: command.endpoint_model_id,
    base_url: command.base_url,
  };
  const endpointBase = {
    id: endpointId,
    endpoint_id: route.endpoint_id,
    base_url: command.base_url,
    ...(command.api_key ? { credential_secret: command.api_key } : {}),
  };
  let endpoint: NewInferenceEndpoint;
  switch (command.api_format) {
    case 'openai_embeddings': {
      const auth = command.api_key ? 'bearer' : 'none';
      model.capabilities = ['embedding'];
      model.embedding_route = {
        ...route,
        api_surface: 'openai_embeddings',
        capability_id: EMBEDDING_CAPABILITY_IDS.OPENAI_COMPATIBLE,
        auth_profile: auth,
        usage: { response_usage: 'provider_reported_optional' },
      };
      endpoint = {
        ...endpointBase,
        route_profile_id: 'openai_compatible_embeddings',
        auth_profile: auth,
      };
      break;
    }
    case 'cohere_rerank':
      model.capabilities = ['rerank'];
      model.reranking_route = {
        ...route,
        api_surface: 'cohere_rerank',
        capability_id: 'ai-sdk:cohere-compatible-reranking',
        auth_profile: 'bearer',
        usage: { response_usage: 'provider_reported_optional' },
      };
      endpoint = {
        ...endpointBase,
        route_profile_id: 'cohere_compatible_reranking',
        auth_profile: 'bearer',
      };
      break;
    case 'openai_images_generations': {
      const auth = command.api_key ? 'bearer' : 'none';
      model.capabilities = ['image_generation'];
      model.image_generation_route = {
        ...route,
        api_surface: 'openai_images_generations',
        capability_id: IMAGE_GENERATION_CAPABILITY_IDS.OPENAI_COMPATIBLE,
        auth_profile: auth,
        response_format: 'b64_json',
        max_images_per_call: 1,
      };
      if (command.image_sizes) model.image_generation = { allowed_sizes: [...command.image_sizes] };
      endpoint = {
        ...endpointBase,
        route_profile_id: 'openai_compatible_image_generation',
        auth_profile: auth,
      };
      break;
    }
    case 'paddle_layout_parsing':
    case 'paddle_ocr_jobs': {
      if (!command.ocr_mode) throw new Error('OCR registration requires an input mode');
      model.capabilities = ['document_ocr'];
      const ocr = {
        ...route,
        mode: command.ocr_mode,
        supports_abort_signal: true,
        attempt_timeout_ms: 120_000,
      };
      if (command.api_format === 'paddle_layout_parsing') {
        model.document_ocr_route = {
          ...ocr,
          api_surface: command.api_format,
          capability_id: DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_LAYOUT_PARSING,
          auth_profile: 'token',
        };
        endpoint = { ...endpointBase, route_profile_id: command.api_format, auth_profile: 'token' };
      } else {
        model.document_ocr_route = {
          ...ocr,
          api_surface: command.api_format,
          capability_id: DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_OCR_JOBS,
          auth_profile: 'bearer',
          poll_interval_ms: 1_000,
        };
        endpoint = {
          ...endpointBase,
          route_profile_id: command.api_format,
          auth_profile: 'bearer',
        };
      }
      break;
    }
  }
  return { model, endpoint: { kind: 'create', endpoint } };
}
