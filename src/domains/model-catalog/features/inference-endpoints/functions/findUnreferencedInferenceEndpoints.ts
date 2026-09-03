import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';

/**
 * InferenceEndpoint 是用户模型的内部实现细节；没有任何模型引用时，它的生命周期就已结束。
 */
export function findUnreferencedInferenceEndpoints(
  models: Iterable<ModelConfig>,
  endpoints: Iterable<InferenceEndpoint>
): InferenceEndpoint[] {
  const referencedEndpointIds = new Set<string>();
  for (const model of models) {
    if (model.inference_endpoint_id) referencedEndpointIds.add(model.inference_endpoint_id);
  }
  return Array.from(endpoints).filter(endpoint => !referencedEndpointIds.has(endpoint.id));
}
