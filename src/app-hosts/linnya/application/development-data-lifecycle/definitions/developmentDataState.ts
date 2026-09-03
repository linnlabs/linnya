/**
 * epoch 2：桌面 Host Schema 从 v1-v60 增量历史切换为 v61 当前事实基线。
 * 默认开发数据必须整体隔离后重建，不能把旧 SQLite、插件状态和 sidecar 混入新基线。
 */
export const CURRENT_DEVELOPMENT_DATA_EPOCH = 2;
export const DEVELOPMENT_DATA_DIRECTORY_NAME = '_dev_data';
export const DEVELOPMENT_DATA_STATE_FILE_NAME = '.linnya-development-data.json';
export const RETIRED_DEVELOPMENT_DATA_DIRECTORY_NAME = '.linnya-development-data-retired';

export interface DevelopmentDataState {
  readonly epoch: number;
  readonly created_at: string;
  readonly app_version: string;
}

export type DevelopmentDataStateObservation =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly state: DevelopmentDataState }
  | { readonly kind: 'invalid'; readonly reason: string };

export type DevelopmentDataAdmissionDecision =
  | { readonly kind: 'initialize' }
  | { readonly kind: 'admit'; readonly state: DevelopmentDataState }
  | { readonly kind: 'reject'; readonly observedEpoch: number | null; readonly reason: string };

export interface DevelopmentDataPaths {
  readonly developmentRoot: string;
  readonly dataRoot: string;
  readonly stateFile: string;
  readonly retiredRoot: string;
}

export interface DevelopmentDataResetResult {
  readonly status: 'absent' | 'retired';
  readonly dataRoot: string;
  readonly retiredPath: string | null;
  readonly byteSize: number;
  readonly topLevelEntries: readonly string[];
}

export interface DevelopmentDataResetInspection {
  readonly dataRoot: string;
  readonly byteSize: number;
  readonly topLevelEntries: readonly string[];
}
