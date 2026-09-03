/** 正式 Provider 已配置身份；不保存 secret、route 或展示资料。 */
export interface ConfiguredProvider {
  readonly id: string;
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
  readonly models: readonly ConfiguredProviderModel[];
}

/** 正式 Provider 目录模型与本地 ModelConfig 的稳定关联。 */
export interface ConfiguredProviderModel {
  readonly provider_model_id: string;
  readonly model_config_id: string;
}

/** 跨文件注册事务的持久化意图。 */
export interface PendingProviderModelRegistration {
  readonly id: string;
  readonly configured_provider_id: string;
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
  readonly inference_endpoint_id: string;
  readonly provider_model_id: string;
  readonly model_config_id: string;
}

/** 跨文件删除事务的持久化意图。 */
export interface PendingProviderModelRemoval {
  readonly id: string;
  readonly model_config_id: string;
}

export type LegacyFormalProviderMigrationStatus = 'pending' | 'completed';

export interface ProviderConfigurationSnapshot {
  readonly legacy_formal_provider_migration: LegacyFormalProviderMigrationStatus;
  readonly configured_providers: readonly ConfiguredProvider[];
  readonly pending_model_registrations: readonly PendingProviderModelRegistration[];
  readonly pending_model_removals: readonly PendingProviderModelRemoval[];
}

export interface ProviderConfigurationCatalogModel {
  readonly id: string;
  readonly inference_endpoint_id?: string;
}

/** 启动恢复只消费 Model Catalog 的稳定公开身份，不读取 route 或 Provider 资料。 */
export interface ProviderConfigurationCatalogProjection {
  readonly models: readonly ProviderConfigurationCatalogModel[];
}

export interface BeginProviderModelRegistrationInput {
  readonly intent_id: string;
  readonly configured_provider_id: string;
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
  readonly inference_endpoint_id: string;
  readonly provider_model_id: string;
  readonly model_config_id: string;
}

export interface BeginProviderModelRemovalInput {
  readonly intent_id: string;
  readonly model_config_id: string;
}

export interface ProviderConfigurationRepository {
  load(): Promise<ProviderConfigurationSnapshot>;
  save(snapshot: ProviderConfigurationSnapshot): Promise<void>;
}
