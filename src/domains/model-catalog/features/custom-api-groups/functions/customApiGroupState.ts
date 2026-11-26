import type { CustomApiGroup } from '../../../definitions/customApiGroup';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { UnadmittedUserModelEntry } from '../../user-model-persistence/definitions/userModelsFile';

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

/**
 * 停用条目的分组归属与已准入模型同一规则：分组名一致，且引用的连接属于这个分组。
 * 列出（模型设置）和删除分组共用这一条，确认框列出的就是会被一起删掉的。
 * 分组改名或换连接后，旧条目不再满足规则，会转为“未归类”，等用户删除；这里不改写停用条目的原始内容。
 */
export function unadmittedEntryBelongsToCustomApiGroup(
  entry: Pick<UnadmittedUserModelEntry, 'customProviderName' | 'inferenceEndpointId'>,
  group: CustomApiGroup
): boolean {
  return (
    entry.customProviderName === group.name &&
    entry.inferenceEndpointId !== undefined &&
    group.inference_endpoint_ids.includes(entry.inferenceEndpointId)
  );
}
