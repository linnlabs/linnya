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
  /** 已准入的用户模型，后接启动时未通过准入、按原样保留的条目。 */
  readonly models: readonly (ModelConfig | PreservedUserModelEntry)[];
}

/** 启动时未通过准入的原始模型条目；Catalog 不解释其内容，只在写盘时原样带回。 */
export type PreservedUserModelEntry = unknown;

export interface StoredUserModelState {
  readonly inferenceEndpoints: readonly unknown[];
  readonly customApiGroups: readonly CustomApiGroup[];
  readonly models: readonly unknown[];
  readonly requiresMigration: boolean;
}
