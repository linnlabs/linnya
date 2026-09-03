import type {
  ModelPickerModelPreference,
  ModelPickerPreferencesSnapshot,
  ModelPickerProviderPreference,
} from '../../../definitions/modelPickerPreferences';

export const MODEL_PICKER_PREFERENCES_FILE_VERSION = '1.0.0';

export interface ModelPickerPreferencesFile extends ModelPickerPreferencesSnapshot {
  readonly version: typeof MODEL_PICKER_PREFERENCES_FILE_VERSION;
  readonly last_updated: string;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return Object.fromEntries(Object.entries(value));
}

function assertExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string
): void {
  const expected = new Set(expectedKeys);
  const unknownKeys = Object.keys(record).filter(key => !expected.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${label} 包含未知字段: ${unknownKeys.join(', ')}`);
  }
}

function readNonBlankString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}.${key} 必须是非空字符串`);
  }
  return value.trim();
}

function readBoolean(record: Record<string, unknown>, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`${label}.${key} 必须是布尔值`);
  return value;
}

function readProviderPreference(value: unknown): ModelPickerProviderPreference {
  const label = 'provider_preferences[]';
  const record = readRecord(value, label);
  assertExactKeys(record, ['configured_provider_id', 'visible'], label);
  return {
    configured_provider_id: readNonBlankString(record, 'configured_provider_id', label),
    visible: readBoolean(record, 'visible', label),
  };
}

function readModelPreference(value: unknown): ModelPickerModelPreference {
  const label = 'model_preferences[]';
  const record = readRecord(value, label);
  assertExactKeys(record, ['model_config_id', 'visible'], label);
  return {
    model_config_id: readNonBlankString(record, 'model_config_id', label),
    visible: readBoolean(record, 'visible', label),
  };
}

/** 开发期只接受当前单版本文件；未知字段和重复 ID 均明确失败。 */
export function readModelPickerPreferencesFile(value: unknown): ModelPickerPreferencesSnapshot {
  const label = 'model_picker_preferences.json';
  const record = readRecord(value, label);
  assertExactKeys(
    record,
    ['version', 'last_updated', 'provider_preferences', 'model_preferences'],
    label
  );
  if (record.version !== MODEL_PICKER_PREFERENCES_FILE_VERSION) {
    throw new Error(`${label}.version 必须是 ${MODEL_PICKER_PREFERENCES_FILE_VERSION}`);
  }
  if (typeof record.last_updated !== 'string') {
    throw new Error(`${label}.last_updated 必须是字符串`);
  }
  if (!Array.isArray(record.provider_preferences) || !Array.isArray(record.model_preferences)) {
    throw new Error(`${label} envelope 无效`);
  }
  const providerPreferences = record.provider_preferences.map(readProviderPreference);
  const modelPreferences = record.model_preferences.map(readModelPreference);
  if (
    new Set(providerPreferences.map(item => item.configured_provider_id)).size !==
    providerPreferences.length
  ) {
    throw new Error(`${label}.provider_preferences 包含重复 ID`);
  }
  if (
    new Set(modelPreferences.map(item => item.model_config_id)).size !== modelPreferences.length
  ) {
    throw new Error(`${label}.model_preferences 包含重复 ID`);
  }
  return {
    provider_preferences: providerPreferences,
    model_preferences: modelPreferences,
  };
}
