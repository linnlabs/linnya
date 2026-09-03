import type {
  ConfiguredProvider,
  ConfiguredProviderModel,
  LegacyFormalProviderMigrationStatus,
  PendingProviderModelRegistration,
  PendingProviderModelRemoval,
  ProviderConfigurationSnapshot,
} from '../../../definitions/providerConfiguration';
import { projectLegacyProviderConnectionIdentity } from '@app/schemas/provider-catalog';

export const PROVIDER_CONFIGURATION_FILE_VERSION = '3.0.0';

export interface ProviderConfigurationFile extends ProviderConfigurationSnapshot {
  readonly version: typeof PROVIDER_CONFIGURATION_FILE_VERSION;
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

function readConfiguredProviderModel(value: unknown): ConfiguredProviderModel {
  const record = readRecord(value, 'configured_provider.models[]');
  assertExactKeys(record, ['provider_model_id', 'model_config_id'], 'configured_provider.models[]');
  return {
    provider_model_id: readNonBlankString(
      record,
      'provider_model_id',
      'configured_provider.models[]'
    ),
    model_config_id: readNonBlankString(record, 'model_config_id', 'configured_provider.models[]'),
  };
}

function readConfiguredProvider(value: unknown): ConfiguredProvider {
  const record = readRecord(value, 'configured_providers[]');
  assertExactKeys(
    record,
    ['id', 'provider_definition_id', 'provider_connection_definition_id', 'models'],
    'configured_providers[]'
  );
  if (!Array.isArray(record.models)) throw new Error('configured_providers[].models 必须是数组');
  return {
    id: readNonBlankString(record, 'id', 'configured_providers[]'),
    provider_definition_id: readNonBlankString(
      record,
      'provider_definition_id',
      'configured_providers[]'
    ),
    provider_connection_definition_id: readNonBlankString(
      record,
      'provider_connection_definition_id',
      'configured_providers[]'
    ),
    models: record.models.map(readConfiguredProviderModel),
  };
}

function readVersionOneConfiguredProvider(value: unknown): ConfiguredProvider {
  const record = readRecord(value, 'configured_providers[]');
  assertExactKeys(
    record,
    ['id', 'provider_definition_id', 'inference_endpoint_id', 'models'],
    'configured_providers[]'
  );
  if (!Array.isArray(record.models)) throw new Error('configured_providers[].models 必须是数组');
  readNonBlankString(record, 'inference_endpoint_id', 'configured_providers[]');
  const legacyProviderDefinitionId = readNonBlankString(
    record,
    'provider_definition_id',
    'configured_providers[]'
  );
  return {
    id: readNonBlankString(record, 'id', 'configured_providers[]'),
    ...projectLegacyProviderConnectionIdentity(legacyProviderDefinitionId),
    models: record.models.map(value => {
      const model = readRecord(value, 'configured_provider.models[]');
      assertExactKeys(
        model,
        ['provider_model_id', 'model_config_id'],
        'configured_provider.models[]'
      );
      return {
        provider_model_id: readNonBlankString(
          model,
          'provider_model_id',
          'configured_provider.models[]'
        ),
        model_config_id: readNonBlankString(
          model,
          'model_config_id',
          'configured_provider.models[]'
        ),
      };
    }),
  };
}

function readVersionTwoConfiguredProvider(value: unknown): ConfiguredProvider {
  const record = readRecord(value, 'configured_providers[]');
  assertExactKeys(record, ['id', 'provider_definition_id', 'models'], 'configured_providers[]');
  if (!Array.isArray(record.models)) throw new Error('configured_providers[].models 必须是数组');
  const legacyProviderDefinitionId = readNonBlankString(
    record,
    'provider_definition_id',
    'configured_providers[]'
  );
  return {
    id: readNonBlankString(record, 'id', 'configured_providers[]'),
    ...projectLegacyProviderConnectionIdentity(legacyProviderDefinitionId),
    models: record.models.map(readConfiguredProviderModel),
  };
}

function readPendingRegistration(value: unknown): PendingProviderModelRegistration {
  const record = readRecord(value, 'pending_model_registrations[]');
  const keys = [
    'id',
    'configured_provider_id',
    'provider_definition_id',
    'provider_connection_definition_id',
    'inference_endpoint_id',
    'provider_model_id',
    'model_config_id',
  ] as const;
  assertExactKeys(record, keys, 'pending_model_registrations[]');
  return {
    id: readNonBlankString(record, 'id', 'pending_model_registrations[]'),
    configured_provider_id: readNonBlankString(
      record,
      'configured_provider_id',
      'pending_model_registrations[]'
    ),
    provider_definition_id: readNonBlankString(
      record,
      'provider_definition_id',
      'pending_model_registrations[]'
    ),
    provider_connection_definition_id: readNonBlankString(
      record,
      'provider_connection_definition_id',
      'pending_model_registrations[]'
    ),
    inference_endpoint_id: readNonBlankString(
      record,
      'inference_endpoint_id',
      'pending_model_registrations[]'
    ),
    provider_model_id: readNonBlankString(
      record,
      'provider_model_id',
      'pending_model_registrations[]'
    ),
    model_config_id: readNonBlankString(record, 'model_config_id', 'pending_model_registrations[]'),
  };
}

function readLegacyPendingRegistration(value: unknown): PendingProviderModelRegistration {
  const record = readRecord(value, 'pending_model_registrations[]');
  const keys = [
    'id',
    'configured_provider_id',
    'provider_definition_id',
    'inference_endpoint_id',
    'provider_model_id',
    'model_config_id',
  ] as const;
  assertExactKeys(record, keys, 'pending_model_registrations[]');
  const legacyProviderDefinitionId = readNonBlankString(
    record,
    'provider_definition_id',
    'pending_model_registrations[]'
  );
  return {
    id: readNonBlankString(record, 'id', 'pending_model_registrations[]'),
    configured_provider_id: readNonBlankString(
      record,
      'configured_provider_id',
      'pending_model_registrations[]'
    ),
    ...projectLegacyProviderConnectionIdentity(legacyProviderDefinitionId),
    inference_endpoint_id: readNonBlankString(
      record,
      'inference_endpoint_id',
      'pending_model_registrations[]'
    ),
    provider_model_id: readNonBlankString(
      record,
      'provider_model_id',
      'pending_model_registrations[]'
    ),
    model_config_id: readNonBlankString(record, 'model_config_id', 'pending_model_registrations[]'),
  };
}

function readPendingRemoval(value: unknown): PendingProviderModelRemoval {
  const record = readRecord(value, 'pending_model_removals[]');
  assertExactKeys(record, ['id', 'model_config_id'], 'pending_model_removals[]');
  return {
    id: readNonBlankString(record, 'id', 'pending_model_removals[]'),
    model_config_id: readNonBlankString(record, 'model_config_id', 'pending_model_removals[]'),
  };
}

function readMigrationStatus(value: unknown): LegacyFormalProviderMigrationStatus {
  if (value !== 'pending' && value !== 'completed') {
    throw new Error('legacy_formal_provider_migration 必须是 pending 或 completed');
  }
  return value;
}

/** 严格读取单版本配置；未知版本和未知字段直接失败，不做长期双读。 */
export function readProviderConfigurationFile(value: unknown): ProviderConfigurationSnapshot {
  const record = readRecord(value, 'provider_configurations.json');
  assertExactKeys(
    record,
    [
      'version',
      'last_updated',
      'legacy_formal_provider_migration',
      'configured_providers',
      'pending_model_registrations',
      'pending_model_removals',
    ],
    'provider_configurations.json'
  );
  if (record.version !== PROVIDER_CONFIGURATION_FILE_VERSION) {
    throw new Error(
      `provider_configurations.json version 必须是 ${PROVIDER_CONFIGURATION_FILE_VERSION}`
    );
  }
  if (typeof record.last_updated !== 'string') {
    throw new Error('provider_configurations.json.last_updated 必须是字符串');
  }
  if (
    !Array.isArray(record.configured_providers) ||
    !Array.isArray(record.pending_model_registrations) ||
    !Array.isArray(record.pending_model_removals)
  ) {
    throw new Error('provider_configurations.json envelope 无效');
  }
  return {
    legacy_formal_provider_migration: readMigrationStatus(record.legacy_formal_provider_migration),
    configured_providers: record.configured_providers.map(readConfiguredProvider),
    pending_model_registrations: record.pending_model_registrations.map(readPendingRegistration),
    pending_model_removals: record.pending_model_removals.map(readPendingRemoval),
  };
}

/**
 * 1.0.0 把 Provider 错误约束为单 endpoint；2.0.0 只保留 Provider 与 ModelConfig 归属；
 * 3.0.0 把唯一性下沉到 connection，并按冻结映射完成品牌归并。
 * 每个模型的 endpoint 已由 ModelConfig 唯一持有，重复保存会制造双真相源。
 * 迁移只接受精确旧结构，成功后 repository 立即覆盖写回当前版本，不形成运行时双真相源。
 */
export function migrateProviderConfigurationFileV1(
  value: unknown
): ProviderConfigurationSnapshot | undefined {
  const record = readRecord(value, 'provider_configurations.json');
  if (record.version !== '1.0.0') return undefined;
  assertExactKeys(
    record,
    [
      'version',
      'last_updated',
      'legacy_formal_provider_migration',
      'configured_providers',
      'pending_model_registrations',
      'pending_model_removals',
    ],
    'provider_configurations.json'
  );
  if (typeof record.last_updated !== 'string') {
    throw new Error('provider_configurations.json.last_updated 必须是字符串');
  }
  if (
    !Array.isArray(record.configured_providers) ||
    !Array.isArray(record.pending_model_registrations) ||
    !Array.isArray(record.pending_model_removals)
  ) {
    throw new Error('provider_configurations.json envelope 无效');
  }
  return {
    legacy_formal_provider_migration: readMigrationStatus(record.legacy_formal_provider_migration),
    configured_providers: record.configured_providers.map(readVersionOneConfiguredProvider),
    pending_model_registrations: record.pending_model_registrations.map(
      readLegacyPendingRegistration
    ),
    pending_model_removals: record.pending_model_removals.map(readPendingRemoval),
  };
}

/** 2.0.0 到 3.0.0 的精确 identity 迁移，成功后 repository 立即写回。 */
export function migrateProviderConfigurationFileV2(
  value: unknown
): ProviderConfigurationSnapshot | undefined {
  const record = readRecord(value, 'provider_configurations.json');
  if (record.version !== '2.0.0') return undefined;
  assertExactKeys(
    record,
    [
      'version',
      'last_updated',
      'legacy_formal_provider_migration',
      'configured_providers',
      'pending_model_registrations',
      'pending_model_removals',
    ],
    'provider_configurations.json'
  );
  if (typeof record.last_updated !== 'string') {
    throw new Error('provider_configurations.json.last_updated 必须是字符串');
  }
  if (
    !Array.isArray(record.configured_providers) ||
    !Array.isArray(record.pending_model_registrations) ||
    !Array.isArray(record.pending_model_removals)
  ) {
    throw new Error('provider_configurations.json envelope 无效');
  }
  return {
    legacy_formal_provider_migration: readMigrationStatus(record.legacy_formal_provider_migration),
    configured_providers: record.configured_providers.map(readVersionTwoConfiguredProvider),
    pending_model_registrations: record.pending_model_registrations.map(
      readLegacyPendingRegistration
    ),
    pending_model_removals: record.pending_model_removals.map(readPendingRemoval),
  };
}
