import type { ProviderCatalog } from '@linnya/provider-catalog';
import type { ModelCatalog } from 'src/domains/model-catalog';
import type { ProviderConfigurationRegistry } from 'src/domains/provider-configuration';
import {
  ProviderModelDiscoveryError,
  type ProviderDiscoveredModel,
  createProviderModelDiscovery,
} from 'src/app-hosts/linnya/adapters/provider-model-discovery';
import type { ProviderOnboardingRuntimeBindingRegistry } from 'src/app-hosts/linnya/adapters/inference';
import type { ProviderModelDiscoveryUseCase } from '../definitions/providerModelDiscovery';

export interface ProviderModelDiscoveryDependencies {
  readonly catalog: Pick<ProviderCatalog, 'getConnection'>;
  readonly configurations: Pick<
    ProviderConfigurationRegistry,
    'getByProviderConnectionDefinitionId'
  >;
  readonly models: Pick<ModelCatalog, 'resolveCredential'>;
  readonly bindings: Pick<ProviderOnboardingRuntimeBindingRegistry, 'get'>;
  readonly discovery: ReturnType<typeof createProviderModelDiscovery>;
}

export function createProviderModelDiscoveryUseCase(
  dependencies: ProviderModelDiscoveryDependencies
): ProviderModelDiscoveryUseCase {
  // 这里保存本进程最近成功取得的候选，不保存凭据，也不替代持久化的用户 ModelConfig。
  const snapshots = new Map<
    string,
    {
      configuredProviderId: string;
      candidates: readonly ProviderDiscoveredModel[];
    }
  >();
  const read = (connectionId: string): readonly ProviderDiscoveredModel[] | undefined => {
    const snapshot = snapshots.get(connectionId);
    const configured =
      dependencies.configurations.getByProviderConnectionDefinitionId(connectionId);
    // 删除并重新连接会生成新身份；旧连接的候选不能限制新凭据的首次注册。
    return configured?.id === snapshot?.configuredProviderId ? snapshot?.candidates : undefined;
  };
  return {
    supports: connectionId => dependencies.discovery.supports(connectionId),
    read,
    readAvailable: connectionId =>
      read(connectionId)?.flatMap(candidate =>
        candidate.status === 'available' ? [candidate.definition] : []
      ),
    async refresh(connectionId, signal) {
      signal?.throwIfAborted();
      const entry = dependencies.catalog.getConnection(connectionId);
      const binding = dependencies.bindings.get(connectionId);
      const configured =
        dependencies.configurations.getByProviderConnectionDefinitionId(connectionId);
      if (!entry || !binding || !configured || !dependencies.discovery.supports(connectionId)) {
        throw new ProviderModelDiscoveryError('该供应商尚未接入在线模型发现', 400);
      }
      const credentialModelId = configured.models[0]?.model_config_id;
      const apiKey = credentialModelId
        ? dependencies.models.resolveCredential(credentialModelId)
        : undefined;
      if (!apiKey) {
        throw new ProviderModelDiscoveryError('供应商凭据不可用，请重新连接后刷新', 401);
      }
      const candidates = await dependencies.discovery.discover({
        connectionId,
        baseUrl: binding.default_base_url,
        apiKey,
        bundledModels: entry.connection.models,
        signal,
      });
      signal?.throwIfAborted();
      // 远端查询完整成功后才替换；失败绝不能把空列表或旧列表当成新发现结果。
      if (
        dependencies.configurations.getByProviderConnectionDefinitionId(connectionId)?.id !==
        configured.id
      ) {
        throw new ProviderModelDiscoveryError('查询期间供应商连接已改变，请重新刷新', 409);
      }
      snapshots.set(connectionId, { configuredProviderId: configured.id, candidates });
    },
  };
}
