import { INFERENCE_ENDPOINT_PROFILES } from '../../../definitions/inferenceEndpointProfiles';

import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';

export function assertEndpointMatchesModel(endpoint: InferenceEndpoint, model: ModelConfig): void {
  const profile = INFERENCE_ENDPOINT_PROFILES.find(item => item.id === endpoint.route_profile_id);
  if (!profile) throw new Error(`未知 InferenceEndpoint profile: ${endpoint.route_profile_id}`);
  const routes = [
    model.inference_route,
    model.embedding_route,
    model.reranking_route,
    model.image_generation_route,
    model.document_ocr_route,
  ].filter(route => route !== undefined);
  if (routes.length !== 1) throw new Error(`用户模型 ${model.id} 必须声明唯一的推理 route`);
  const route = routes[0];
  // route 只保存 wire surface/capability，多个正式产品可以有意复用同一 codec。
  // profile 身份属于 endpoint，必须从 endpoint 的显式字段读取，再验证其 wire 合同；
  // 不能从 route 反推，否则 ChatGPT Codex 会被误判成普通 OpenAI Responses。
  if (
    profile.api_surface !== route.api_surface ||
    profile.capability_id !== route.capability_id ||
    endpoint.endpoint_id !== route.endpoint_id ||
    endpoint.base_url !== route.base_url ||
    endpoint.auth_profile !== route.auth_profile
  ) {
    throw new Error(`用户模型 ${model.id} 的 route 与 InferenceEndpoint ${endpoint.id} 不一致`);
  }
}
