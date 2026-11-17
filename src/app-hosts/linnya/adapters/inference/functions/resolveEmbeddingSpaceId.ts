import { createHash } from 'node:crypto';
import type { ModelEmbeddingRoute } from '@app/schemas/model-inference';

/**
 * 与 OpenAI-compatible adapter 实际发出的 URL 使用相同组合规则。
 * 凭据、显示名、本地模型/endpoint ID 不决定向量空间；供应商偷偷替换同一 alias 的权重无法从配置检测。
 */
export function resolveEmbeddingSpaceId(route: ModelEmbeddingRoute): string {
  const requestUrl = new URL(`${route.base_url.replace(/\/+$/, '')}/embeddings`).href;
  const identity = JSON.stringify({
    apiSurface: route.api_surface,
    capabilityId: route.capability_id,
    requestUrl,
    model: route.endpoint_model_id,
  });
  return `embedding-space:v1:${createHash('sha256').update(identity).digest('hex')}`;
}
