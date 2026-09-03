import type {
  BeginProviderModelRegistrationInput,
  BeginProviderModelRemovalInput,
  ConfiguredProvider,
  PendingProviderModelRegistration,
  PendingProviderModelRemoval,
  ProviderConfigurationCatalogProjection,
  ProviderConfigurationRepository,
  ProviderConfigurationSnapshot,
} from '../definitions/providerConfiguration';
import { fileProviderConfigurationRepository } from '../features/configuration-persistence/orchestration/fileProviderConfigurationRepository';

function cloneProvider(provider: ConfiguredProvider): ConfiguredProvider {
  return { ...provider, models: provider.models.map(model => ({ ...model })) };
}

function cloneSnapshot(snapshot: ProviderConfigurationSnapshot): ProviderConfigurationSnapshot {
  return {
    legacy_formal_provider_migration: snapshot.legacy_formal_provider_migration,
    configured_providers: snapshot.configured_providers.map(cloneProvider),
    pending_model_registrations: snapshot.pending_model_registrations.map(intent => ({
      ...intent,
    })),
    pending_model_removals: snapshot.pending_model_removals.map(intent => ({ ...intent })),
  };
}

function assertUniqueSnapshot(snapshot: ProviderConfigurationSnapshot): void {
  const providerIds = new Set<string>();
  const providerConnectionDefinitionIds = new Set<string>();
  const modelConfigIds = new Set<string>();
  const intentIds = new Set<string>();

  for (const provider of snapshot.configured_providers) {
    if (providerIds.has(provider.id)) throw new Error(`重复 ConfiguredProvider ID: ${provider.id}`);
    if (providerConnectionDefinitionIds.has(provider.provider_connection_definition_id)) {
      throw new Error(`重复正式 connection 配置: ${provider.provider_connection_definition_id}`);
    }
    providerIds.add(provider.id);
    providerConnectionDefinitionIds.add(provider.provider_connection_definition_id);
    const providerModelIds = new Set<string>();
    for (const model of provider.models) {
      if (providerModelIds.has(model.provider_model_id)) {
        throw new Error(`ConfiguredProvider ${provider.id} 重复模型: ${model.provider_model_id}`);
      }
      if (modelConfigIds.has(model.model_config_id)) {
        throw new Error(`ModelConfig 已关联多个正式 Provider: ${model.model_config_id}`);
      }
      providerModelIds.add(model.provider_model_id);
      modelConfigIds.add(model.model_config_id);
    }
  }
  for (const intent of [
    ...snapshot.pending_model_registrations,
    ...snapshot.pending_model_removals,
  ]) {
    if (intentIds.has(intent.id))
      throw new Error(`重复 Provider configuration intent: ${intent.id}`);
    intentIds.add(intent.id);
  }
}

function removeModelAssociation(
  providers: readonly ConfiguredProvider[],
  modelConfigId: string
): ConfiguredProvider[] {
  return providers
    .map(provider => ({
      ...provider,
      models: provider.models.filter(model => model.model_config_id !== modelConfigId),
    }))
    .filter(provider => provider.models.length > 0);
}

function applyRegistration(
  providers: readonly ConfiguredProvider[],
  intent: PendingProviderModelRegistration
): ConfiguredProvider[] {
  const existing = providers.find(
    provider =>
      provider.provider_connection_definition_id === intent.provider_connection_definition_id
  );
  if (!existing) {
    return [
      ...providers.map(cloneProvider),
      {
        id: intent.configured_provider_id,
        provider_definition_id: intent.provider_definition_id,
        provider_connection_definition_id: intent.provider_connection_definition_id,
        models: [
          {
            provider_model_id: intent.provider_model_id,
            model_config_id: intent.model_config_id,
          },
        ],
      },
    ];
  }
  if (
    existing.id !== intent.configured_provider_id ||
    existing.provider_definition_id !== intent.provider_definition_id
  ) {
    throw new Error(`正式 connection ${intent.provider_connection_definition_id} 的配置身份不一致`);
  }
  const alreadyLinked = existing.models.find(
    model => model.model_config_id === intent.model_config_id
  );
  if (alreadyLinked) {
    if (alreadyLinked.provider_model_id !== intent.provider_model_id) {
      throw new Error(`ModelConfig ${intent.model_config_id} 的 Provider 模型身份不一致`);
    }
    return providers.map(cloneProvider);
  }
  if (existing.models.some(model => model.provider_model_id === intent.provider_model_id)) {
    throw new Error(`Provider 模型已经激活: ${intent.provider_model_id}`);
  }
  return providers.map(provider =>
    provider.id === existing.id
      ? {
          ...provider,
          models: [
            ...provider.models.map(model => ({ ...model })),
            {
              provider_model_id: intent.provider_model_id,
              model_config_id: intent.model_config_id,
            },
          ],
        }
      : cloneProvider(provider)
  );
}

export class ProviderConfigurationRegistry {
  private snapshot: ProviderConfigurationSnapshot | null = null;

  constructor(private readonly repository: ProviderConfigurationRepository) {}

  async initialize(catalog: ProviderConfigurationCatalogProjection): Promise<void> {
    if (this.snapshot) return;
    const loaded = await this.repository.load();
    assertUniqueSnapshot(loaded);
    const reconciled = this.reconcileSnapshot(loaded, catalog);
    if (JSON.stringify(reconciled) !== JSON.stringify(loaded)) {
      await this.repository.save(reconciled);
    }
    this.snapshot = cloneSnapshot(reconciled);
  }

  list(): readonly ConfiguredProvider[] {
    return this.requireSnapshot().configured_providers.map(cloneProvider);
  }

  getByProviderConnectionDefinitionId(
    providerConnectionDefinitionId: string
  ): ConfiguredProvider | undefined {
    const provider = this.requireSnapshot().configured_providers.find(
      candidate => candidate.provider_connection_definition_id === providerConnectionDefinitionId
    );
    return provider ? cloneProvider(provider) : undefined;
  }

  getByModelConfigId(modelConfigId: string): ConfiguredProvider | undefined {
    const provider = this.requireSnapshot().configured_providers.find(candidate =>
      candidate.models.some(model => model.model_config_id === modelConfigId)
    );
    return provider ? cloneProvider(provider) : undefined;
  }

  needsLegacyFormalProviderMigration(): boolean {
    return this.requireSnapshot().legacy_formal_provider_migration === 'pending';
  }

  async completeLegacyFormalProviderMigration(
    migratedProviders: readonly ConfiguredProvider[]
  ): Promise<void> {
    const current = this.requireSnapshot();
    if (current.legacy_formal_provider_migration === 'completed') return;
    const next: ProviderConfigurationSnapshot = {
      ...cloneSnapshot(current),
      legacy_formal_provider_migration: 'completed',
      configured_providers: [
        ...current.configured_providers.map(cloneProvider),
        ...migratedProviders.map(cloneProvider),
      ],
    };
    assertUniqueSnapshot(next);
    await this.commit(next);
  }

  async beginModelRegistration(
    input: BeginProviderModelRegistrationInput
  ): Promise<PendingProviderModelRegistration> {
    const current = this.requireSnapshot();
    const existing = current.configured_providers.find(
      provider =>
        provider.provider_connection_definition_id === input.provider_connection_definition_id
    );
    if (
      existing &&
      (existing.id !== input.configured_provider_id ||
        existing.provider_definition_id !== input.provider_definition_id)
    ) {
      throw new Error(
        `正式 connection ${input.provider_connection_definition_id} 的配置身份不一致`
      );
    }
    if (
      current.configured_providers.some(provider =>
        provider.models.some(model => model.model_config_id === input.model_config_id)
      ) ||
      current.pending_model_registrations.some(
        intent => intent.model_config_id === input.model_config_id
      )
    ) {
      throw new Error(`ModelConfig 已存在 Provider 归属: ${input.model_config_id}`);
    }
    if (
      existing?.models.some(model => model.provider_model_id === input.provider_model_id) ||
      current.pending_model_registrations.some(
        intent =>
          intent.provider_connection_definition_id === input.provider_connection_definition_id &&
          intent.provider_model_id === input.provider_model_id
      )
    ) {
      throw new Error(`Provider 模型已经激活: ${input.provider_model_id}`);
    }
    const intent: PendingProviderModelRegistration = {
      id: input.intent_id,
      configured_provider_id: input.configured_provider_id,
      provider_definition_id: input.provider_definition_id,
      provider_connection_definition_id: input.provider_connection_definition_id,
      inference_endpoint_id: input.inference_endpoint_id,
      provider_model_id: input.provider_model_id,
      model_config_id: input.model_config_id,
    };
    const next: ProviderConfigurationSnapshot = {
      ...cloneSnapshot(current),
      pending_model_registrations: [
        ...current.pending_model_registrations.map(candidate => ({ ...candidate })),
        intent,
      ],
    };
    assertUniqueSnapshot(next);
    await this.commit(next);
    return { ...intent };
  }

  async completeModelRegistration(intentId: string): Promise<void> {
    const current = this.requireSnapshot();
    const intent = current.pending_model_registrations.find(candidate => candidate.id === intentId);
    if (!intent) throw new Error(`Provider model registration intent 不存在: ${intentId}`);
    const next: ProviderConfigurationSnapshot = {
      ...cloneSnapshot(current),
      configured_providers: applyRegistration(current.configured_providers, intent),
      pending_model_registrations: current.pending_model_registrations
        .filter(candidate => candidate.id !== intentId)
        .map(candidate => ({ ...candidate })),
    };
    assertUniqueSnapshot(next);
    await this.commit(next);
  }

  async cancelModelRegistration(intentId: string): Promise<void> {
    const current = this.requireSnapshot();
    if (!current.pending_model_registrations.some(intent => intent.id === intentId)) return;
    await this.commit({
      ...cloneSnapshot(current),
      pending_model_registrations: current.pending_model_registrations
        .filter(intent => intent.id !== intentId)
        .map(intent => ({ ...intent })),
    });
  }

  async beginModelRemoval(
    input: BeginProviderModelRemovalInput
  ): Promise<PendingProviderModelRemoval | null> {
    const current = this.requireSnapshot();
    if (!this.getByModelConfigId(input.model_config_id)) return null;
    if (
      current.pending_model_removals.some(
        intent => intent.model_config_id === input.model_config_id
      )
    ) {
      throw new Error(`ModelConfig 已在删除中: ${input.model_config_id}`);
    }
    const intent: PendingProviderModelRemoval = {
      id: input.intent_id,
      model_config_id: input.model_config_id,
    };
    await this.commit({
      ...cloneSnapshot(current),
      pending_model_removals: [
        ...current.pending_model_removals.map(candidate => ({ ...candidate })),
        intent,
      ],
    });
    return { ...intent };
  }

  async completeModelRemoval(intentId: string): Promise<void> {
    const current = this.requireSnapshot();
    const intent = current.pending_model_removals.find(candidate => candidate.id === intentId);
    if (!intent) throw new Error(`Provider model removal intent 不存在: ${intentId}`);
    await this.commit({
      ...cloneSnapshot(current),
      configured_providers: removeModelAssociation(
        current.configured_providers,
        intent.model_config_id
      ),
      pending_model_removals: current.pending_model_removals
        .filter(candidate => candidate.id !== intentId)
        .map(candidate => ({ ...candidate })),
    });
  }

  async cancelModelRemoval(intentId: string): Promise<void> {
    const current = this.requireSnapshot();
    if (!current.pending_model_removals.some(intent => intent.id === intentId)) return;
    await this.commit({
      ...cloneSnapshot(current),
      pending_model_removals: current.pending_model_removals
        .filter(intent => intent.id !== intentId)
        .map(intent => ({ ...intent })),
    });
  }

  private reconcileSnapshot(
    snapshot: ProviderConfigurationSnapshot,
    catalog: ProviderConfigurationCatalogProjection
  ): ProviderConfigurationSnapshot {
    const models = new Map(catalog.models.map(model => [model.id, model]));
    let providers = snapshot.configured_providers.map(cloneProvider);

    for (const intent of snapshot.pending_model_registrations) {
      const model = models.get(intent.model_config_id);
      if (!model) continue;
      if (model.inference_endpoint_id !== intent.inference_endpoint_id) {
        throw new Error(`待恢复 ModelConfig ${model.id} 的 endpoint 身份不一致`);
      }
      providers = applyRegistration(providers, intent);
    }
    for (const intent of snapshot.pending_model_removals) {
      if (!models.has(intent.model_config_id)) {
        providers = removeModelAssociation(providers, intent.model_config_id);
      }
    }
    providers = providers
      .map(provider => ({
        ...provider,
        models: provider.models.filter(model => models.has(model.model_config_id)),
      }))
      .filter(provider => provider.models.length > 0);

    const next: ProviderConfigurationSnapshot = {
      legacy_formal_provider_migration: snapshot.legacy_formal_provider_migration,
      configured_providers: providers,
      pending_model_registrations: [],
      pending_model_removals: [],
    };
    assertUniqueSnapshot(next);
    return next;
  }

  private async commit(next: ProviderConfigurationSnapshot): Promise<void> {
    assertUniqueSnapshot(next);
    await this.repository.save(next);
    this.snapshot = cloneSnapshot(next);
  }

  private requireSnapshot(): ProviderConfigurationSnapshot {
    if (!this.snapshot) throw new Error('ProviderConfigurationRegistry 尚未初始化');
    return this.snapshot;
  }
}

export const providerConfigurationRegistry = new ProviderConfigurationRegistry(
  fileProviderConfigurationRepository
);
