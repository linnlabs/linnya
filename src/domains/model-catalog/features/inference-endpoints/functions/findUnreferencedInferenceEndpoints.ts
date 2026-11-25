import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { CustomApiGroup } from '../../../definitions/customApiGroup';

/**
 * 连接既可被模型引用，也可被独立自定义分组引用；空组仍需保留刷新凭据。
 * 停用（启动时未通过准入）、原样保留在文件里的模型条目同样算引用，不能借删除其他模型回收它的连接与凭据。
 */
export function findUnreferencedInferenceEndpoints(
  models: Iterable<ModelConfig>,
  endpoints: Iterable<InferenceEndpoint>,
  groups: Iterable<CustomApiGroup> = [],
  unadmittedModelEndpointIds: Iterable<string> = []
): InferenceEndpoint[] {
  const referencedEndpointIds = new Set<string>(unadmittedModelEndpointIds);
  for (const model of models) {
    if (model.inference_endpoint_id) referencedEndpointIds.add(model.inference_endpoint_id);
  }
  for (const group of groups) {
    for (const id of group.inference_endpoint_ids) referencedEndpointIds.add(id);
  }
  return Array.from(endpoints).filter(endpoint => !referencedEndpointIds.has(endpoint.id));
}
