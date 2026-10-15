import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { CustomApiGroup } from '../../../definitions/customApiGroup';
/** v5 将自定义分组连接归属与模型生命周期分开；v4 仅在加载时迁移一次。 */
export const USER_MODELS_FILE_VERSION = '5.0.0';

export interface UserModelsFile {
  readonly version: typeof USER_MODELS_FILE_VERSION;
  readonly last_updated: string;
  readonly inference_endpoints: readonly InferenceEndpoint[];
  readonly custom_api_groups: readonly CustomApiGroup[];
  readonly models: readonly ModelConfig[];
}

export interface StoredUserModelState {
  readonly inferenceEndpoints: readonly unknown[];
  readonly customApiGroups: readonly CustomApiGroup[];
  readonly models: readonly unknown[];
  readonly requiresMigration: boolean;
}
