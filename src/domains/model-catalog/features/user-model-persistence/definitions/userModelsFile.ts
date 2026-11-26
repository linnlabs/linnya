import type { UnadmittedModelReasonKind } from '@app/schemas/model-picker';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { CustomApiGroup } from '../../../definitions/customApiGroup';
/** v5 将自定义分组连接归属与模型生命周期分开；v4 仅在加载时迁移一次。 */
export const USER_MODELS_FILE_VERSION = '5.0.0';

export interface UserModelsFile {
  readonly version: typeof USER_MODELS_FILE_VERSION;
  readonly last_updated: string;
  readonly inference_endpoints: readonly InferenceEndpoint[];
  readonly custom_api_groups: readonly CustomApiGroup[];
  /**
   * 已准入模型的持久化投影，后接启动时停用、原样保留的条目。
   * 停用条目的内容没有通过准入、Catalog 也不解释它，所以这里只能如实写成 unknown；
   * 已准入模型的类型在 `ModelPersister.saveState` 的参数上约束，读取时逐条重新准入。
   */
  readonly models: readonly unknown[];
}

/**
 * 启动时没有通过准入而停用的用户模型条目（例如旧版写出的双 route 模型）。
 * `raw` 是文件里的原始内容，之后每次写盘原样带回或在删除、修复时整条移除；
 * 只读出身份、归属与显示名，供连接回收、归属对账和界面列出使用。
 */
export interface UnadmittedUserModelEntry {
  readonly raw: unknown;
  readonly id: string | undefined;
  readonly inferenceEndpointId: string | undefined;
  readonly customProviderName: string | undefined;
  readonly displayName: string | undefined;
  readonly reason: string;
  readonly reasonKind: UnadmittedModelReasonKind;
}

export interface StoredUserModelState {
  readonly inferenceEndpoints: readonly unknown[];
  readonly customApiGroups: readonly CustomApiGroup[];
  readonly models: readonly unknown[];
  readonly requiresMigration: boolean;
}
