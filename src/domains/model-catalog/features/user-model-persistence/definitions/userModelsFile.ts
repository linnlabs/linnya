import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';

/**
 * 4.0.0 删除语义错误的 provider 字段，并把 URL/协议/凭据实体明确命名为 inference endpoint。
 * 这是开发期不兼容合同；旧格式不在运行时双读。
 */
export const USER_MODELS_FILE_VERSION = '4.0.0';

export interface UserModelsFile {
  readonly version: typeof USER_MODELS_FILE_VERSION;
  readonly last_updated: string;
  readonly inference_endpoints: readonly InferenceEndpoint[];
  readonly models: readonly ModelConfig[];
}

export interface StoredUserModelState {
  readonly inferenceEndpoints: readonly unknown[];
  readonly models: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON 边界只确认文件 envelope；每个模型由 catalog admission 统一完成严格准入。 */
export function readStoredUserModelState(value: unknown): StoredUserModelState {
  if (!isRecord(value) || value.version !== USER_MODELS_FILE_VERSION) {
    throw new Error(`user_models.json version 必须是 ${USER_MODELS_FILE_VERSION}`);
  }
  if (
    typeof value.last_updated !== 'string' ||
    !Array.isArray(value.inference_endpoints) ||
    !Array.isArray(value.models)
  ) {
    throw new Error('user_models.json envelope 无效');
  }
  return { inferenceEndpoints: value.inference_endpoints, models: value.models };
}
