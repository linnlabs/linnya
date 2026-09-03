export interface ModelPickerProviderPreference {
  readonly configured_provider_id: string;
  readonly visible: boolean;
}

export interface ModelPickerModelPreference {
  readonly model_config_id: string;
  readonly visible: boolean;
}

/**
 * 稀疏偏好快照。
 *
 * 只保存用户明确修改过的值；目录默认值由 app-level read model 按模型来源计算，
 * 避免 Provider Catalog 扩容时向工作区写入成千上万条无意义记录。
 */
export interface ModelPickerPreferencesSnapshot {
  readonly provider_preferences: readonly ModelPickerProviderPreference[];
  readonly model_preferences: readonly ModelPickerModelPreference[];
}

export interface ModelPickerPreferencesRepository {
  load(): Promise<ModelPickerPreferencesSnapshot>;
  save(snapshot: ModelPickerPreferencesSnapshot): Promise<void>;
}

export interface ModelPickerPreferenceIdentities {
  readonly configured_provider_ids: readonly string[];
  readonly model_config_ids: readonly string[];
}
