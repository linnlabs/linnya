import { CustomApiGroupSchema, type CustomApiGroup } from '../../../definitions/customApiGroup';
import { USER_MODELS_FILE_VERSION, type StoredUserModelState } from '../definitions/userModelsFile';
import { projectNamedCustomApiGroups } from './projectNamedCustomApiGroups';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 文件边界读取分组合同；模型与 endpoint 仍由 Catalog 统一准入后才覆盖迁移文件。 */
export function readStoredUserModelState(value: unknown): StoredUserModelState {
  if (
    !isRecord(value) ||
    (value.version !== USER_MODELS_FILE_VERSION && value.version !== '4.0.0')
  ) {
    throw new Error(`user_models.json version 必须是 ${USER_MODELS_FILE_VERSION}`);
  }
  if (
    typeof value.last_updated !== 'string' ||
    !Array.isArray(value.inference_endpoints) ||
    !Array.isArray(value.models)
  ) {
    throw new Error('user_models.json envelope 无效');
  }
  let groups: CustomApiGroup[];
  if (value.version === '4.0.0') {
    groups = projectNamedCustomApiGroups(value.models);
  } else {
    if (!Array.isArray(value.custom_api_groups))
      throw new Error('user_models.json envelope 无效：custom_api_groups 必须是数组');
    groups = value.custom_api_groups.map(value => CustomApiGroupSchema.parse(value));
  }
  if (new Set(groups.map(group => group.name)).size !== groups.length) {
    throw new Error('user_models.json 自定义 API 分组名称重复');
  }
  return {
    inferenceEndpoints: value.inference_endpoints,
    customApiGroups: groups,
    models: value.models,
    requiresMigration: value.version === '4.0.0',
  };
}
