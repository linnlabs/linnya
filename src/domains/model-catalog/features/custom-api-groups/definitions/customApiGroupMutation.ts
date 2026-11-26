import type { CustomApiGroup, CustomApiGroupMigration } from '../../../definitions/customApiGroup';
import type {
  InferenceEndpoint,
  InferenceEndpointSelection,
} from '../../../definitions/inferenceEndpoint';
import type {
  ModelConfig,
  ModelDiff,
  UserModelRegistration,
} from '../../../definitions/modelCatalog';
import type { UnadmittedUserModelEntry } from '../../user-model-persistence/definitions/userModelsFile';
export type CustomApiGroupMutation =
  | {
      readonly kind: 'register';
      readonly name: string;
      readonly registrations: readonly UserModelRegistration[];
    }
  | { readonly kind: 'diff'; readonly name: string; readonly diff: ModelDiff }
  | {
      readonly kind: 'rebind';
      readonly currentName: string;
      readonly name: string;
      readonly models: readonly ModelConfig[];
      readonly endpoint: InferenceEndpointSelection;
    }
  | { readonly kind: 'remove'; readonly name: string }
  | { readonly kind: 'migrate'; readonly groups: readonly CustomApiGroupMigration[] };

export interface CustomApiGroupState {
  readonly models: ReadonlyMap<string, ModelConfig>;
  readonly endpoints: ReadonlyMap<string, InferenceEndpoint>;
  readonly groups: ReadonlyMap<string, CustomApiGroup>;
  /** 启动时停用、原样保留的条目；只有删除分组会连带移除其中属于该分组的。 */
  readonly unadmitted: readonly UnadmittedUserModelEntry[];
}
