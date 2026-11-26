import type { CustomApiGroup } from '../../../definitions/customApiGroup';
import type { UnadmittedUserModel } from '../../../definitions/modelCatalog';
import { unadmittedEntryBelongsToCustomApiGroup } from '../../custom-api-groups/functions/customApiGroupState';
import type { UnadmittedUserModelEntry } from '../definitions/userModelsFile';

/** 停用条目的公开读模型：归属按当前分组计算，原始配置不出 Catalog。 */
export function projectUnadmittedUserModels(
  entries: readonly UnadmittedUserModelEntry[],
  groups: Iterable<CustomApiGroup>
): UnadmittedUserModel[] {
  const groupList = Array.from(groups);
  return entries.map(entry => ({
    id: entry.id,
    inference_endpoint_id: entry.inferenceEndpointId,
    custom_api_group_name: groupList.find(group =>
      unadmittedEntryBelongsToCustomApiGroup(entry, group)
    )?.name,
    display_name: entry.displayName,
    reason: entry.reason,
    reason_kind: entry.reasonKind,
  }));
}
