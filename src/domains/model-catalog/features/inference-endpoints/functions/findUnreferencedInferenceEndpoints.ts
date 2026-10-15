import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { CustomApiGroup } from '../../../definitions/customApiGroup';

/**
 * 连接既可被模型引用，也可被独立自定义分组引用；空组仍需保留刷新凭据。
 */
export function findUnreferencedInferenceEndpoints(
  models: Iterable<ModelConfig>,
  endpoints: Iterable<InferenceEndpoint>,
  groups: Iterable<CustomApiGroup> = []
): InferenceEndpoint[] {
  const referencedEndpointIds = new Set<string>();
  for (const model of models) {
    if (model.inference_endpoint_id) referencedEndpointIds.add(model.inference_endpoint_id);
  }
  for (const group of groups) {
    for (const id of group.inference_endpoint_ids) referencedEndpointIds.add(id);
  }
  return Array.from(endpoints).filter(endpoint => !referencedEndpointIds.has(endpoint.id));
}
