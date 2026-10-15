import { CustomApiGroupSchema, type CustomApiGroup } from '../../../definitions/customApiGroup';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { ModelConfig } from '../../../definitions/modelCatalog';
import type {
  CustomApiGroupMutation,
  CustomApiGroupState,
} from '../definitions/customApiGroupMutation';
import {
  assertCustomApiGroupEndpoints,
  belongsToCustomApiGroup,
  requireCustomApiGroup,
} from './customApiGroupState';

/** 分组成员、模型差异与连接引用的完整下一版本，只计算、不发布状态。 */
export function planCustomApiGroupMutation(
  mutation: CustomApiGroupMutation,
  state: CustomApiGroupState,
  bindModel: (model: ModelConfig, endpoint: InferenceEndpoint) => ModelConfig
) {
  const models = new Map(state.models);
  const endpoints = new Map(state.endpoints);
  const groups = new Map(state.groups);
  let changed = false;
  const saveGroup = (name: string, ids: Iterable<string>) => {
    const group = CustomApiGroupSchema.parse({ name, inference_endpoint_ids: [...new Set(ids)] });
    assertCustomApiGroupEndpoints(group, endpoints);
    groups.set(group.name, group);
    return group;
  };
  const requireMember = (id: string, group: CustomApiGroup) => {
    const model = models.get(id);
    if (!model || !belongsToCustomApiGroup(model, group)) {
      throw new Error(`模型 ${id} 不属于自定义 API 分组 ${group.name}`);
    }
    return model;
  };
  switch (mutation.kind) {
    case 'register': {
      if (mutation.registrations.length === 0) throw new Error('批量注册至少需要一个用户模型');
      const endpointIds = new Set(groups.get(mutation.name)?.inference_endpoint_ids ?? []);
      for (const { model, endpoint } of mutation.registrations) {
        if (models.has(model.id)) throw new Error(`注册模型 ID 重复或已存在: ${model.id}`);
        const selectedEndpointId =
          endpoint.kind === 'existing' ? endpoint.inference_endpoint_id : endpoint.endpoint.id;
        const preparedEndpoint = endpoints.get(selectedEndpointId);
        if (!preparedEndpoint) throw new Error(`InferenceEndpoint 不存在: ${selectedEndpointId}`);
        const bound = bindModel(
          { ...model, custom_provider_name: mutation.name },
          preparedEndpoint
        );
        models.set(bound.id, bound);
        endpointIds.add(preparedEndpoint.id);
      }
      saveGroup(mutation.name, endpointIds);
      changed = true;
      break;
    }
    case 'diff': {
      const group = requireCustomApiGroup(groups, mutation.name);
      const touchedIds = [...mutation.diff.added, ...mutation.diff.updated]
        .map(model => model.id)
        .concat(mutation.diff.removed);
      if (new Set(touchedIds).size !== touchedIds.length) throw new Error('模型差异包含重复 ID');
      for (const model of mutation.diff.added) {
        if (models.has(model.id)) throw new Error(`注册模型 ID 重复或已存在: ${model.id}`);
      }
      for (const model of mutation.diff.updated) requireMember(model.id, group);
      for (const model of [...mutation.diff.added, ...mutation.diff.updated]) {
        if (!belongsToCustomApiGroup(model, group) || !model.inference_endpoint_id) {
          throw new Error(`模型 ${model.id} 的自定义 API 分组或连接不匹配`);
        }
        const endpoint = endpoints.get(model.inference_endpoint_id);
        if (!endpoint) throw new Error(`InferenceEndpoint 不存在: ${model.inference_endpoint_id}`);
        models.set(model.id, bindModel(model, endpoint));
      }
      for (const id of mutation.diff.removed) {
        requireMember(id, group);
        models.delete(id);
      }
      changed = touchedIds.length > 0;
      break;
    }
    case 'rebind': {
      const group = requireCustomApiGroup(groups, mutation.currentName);
      if (mutation.name !== mutation.currentName && groups.has(mutation.name)) {
        throw new Error(`自定义 API 分组已存在: ${mutation.name}`);
      }
      const currentIds = [...models.values()]
        .filter(model => belongsToCustomApiGroup(model, group))
        .map(model => model.id);
      if (
        new Set(mutation.models.map(model => model.id)).size !== currentIds.length ||
        mutation.models.length !== currentIds.length
      )
        throw new Error('改绑必须包含分组的全部模型');
      for (const model of mutation.models) requireMember(model.id, group);
      const selectedEndpointId =
        mutation.endpoint.kind === 'existing'
          ? mutation.endpoint.inference_endpoint_id
          : mutation.endpoint.endpoint.id;
      const preparedEndpoint = endpoints.get(selectedEndpointId);
      if (!preparedEndpoint) throw new Error(`InferenceEndpoint 不存在: ${selectedEndpointId}`);
      for (const model of mutation.models) {
        models.set(
          model.id,
          bindModel({ ...model, custom_provider_name: mutation.name }, preparedEndpoint)
        );
      }
      groups.delete(group.name);
      saveGroup(mutation.name, [preparedEndpoint.id]);
      changed = true;
      break;
    }
    case 'remove': {
      const group = requireCustomApiGroup(groups, mutation.name);
      for (const model of models.values()) {
        if (belongsToCustomApiGroup(model, group)) models.delete(model.id);
      }
      groups.delete(group.name);
      changed = true;
      break;
    }
    case 'migrate': {
      const assignedIds = new Set<string>();
      for (const input of mutation.groups) {
        const previous = groups.get(input.name);
        const ids = new Set(previous?.inference_endpoint_ids ?? []);
        for (const id of input.model_ids) {
          if (assignedIds.has(id)) throw new Error(`自定义 API 迁移模型归属重复: ${id}`);
          assignedIds.add(id);
          const model = models.get(id);
          if (model?.catalog_source !== 'user' || !model.inference_endpoint_id) {
            throw new Error(`自定义 API 迁移模型不是已接入的用户模型: ${id}`);
          }
          ids.add(model.inference_endpoint_id);
          if (model.custom_provider_name !== input.name) {
            const endpoint = endpoints.get(model.inference_endpoint_id);
            if (!endpoint)
              throw new Error(`InferenceEndpoint 不存在: ${model.inference_endpoint_id}`);
            models.set(id, bindModel({ ...model, custom_provider_name: input.name }, endpoint));
            changed = true;
          }
        }
        // App 只提交真实旧模型归属；独立空组不会因启动迁移被删除。
        if (ids.size === 0) throw new Error('自定义 API 迁移分组必须引用连接');
        if (!previous || ids.size !== previous.inference_endpoint_ids.length) {
          saveGroup(input.name, ids);
          changed = true;
        }
      }
      break;
    }
  }
  return { models, endpoints, groups, changed };
}
