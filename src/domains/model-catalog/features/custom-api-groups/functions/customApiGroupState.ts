import type { CustomApiGroup } from '../../../definitions/customApiGroup';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { ModelConfig } from '../../../definitions/modelCatalog';

export function assertCustomApiGroupEndpoints(
  group: CustomApiGroup,
  endpoints: ReadonlyMap<string, InferenceEndpoint>
): void {
  for (const id of group.inference_endpoint_ids) {
    if (!endpoints.has(id))
      throw new Error(`自定义 API 分组 ${group.name} 引用不存在的 InferenceEndpoint: ${id}`);
  }
}

export function requireCustomApiGroup(
  groups: ReadonlyMap<string, CustomApiGroup>,
  name: string
): CustomApiGroup {
  const group = groups.get(name);
  if (!group) throw new Error(`自定义 API 分组不存在: ${name}`);
  return group;
}

export function belongsToCustomApiGroup(model: ModelConfig, group: CustomApiGroup): boolean {
  return (
    model.catalog_source === 'user' &&
    model.custom_provider_name === group.name &&
    model.inference_endpoint_id !== undefined &&
    group.inference_endpoint_ids.includes(model.inference_endpoint_id)
  );
}
