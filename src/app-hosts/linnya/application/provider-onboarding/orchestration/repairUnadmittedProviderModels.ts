import { resolveProviderOnboardingModelRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';
import { getLogger } from 'src/shared/logger';

import type { ProviderModelDiscoveryReadPort } from '../../provider-model-discovery';
import { ProviderOnboardingError } from '../definitions/providerOnboardingError';
import type {
  ProviderModelRepairResult,
  ProviderOnboardingAccountPort,
  ProviderOnboardingCatalogPort,
  ProviderOnboardingConfigurationPort,
  ProviderOnboardingIdFactory,
  ProviderOnboardingModelCatalogPort,
  ProviderOnboardingRuntimeBindingPort,
} from '../definitions/providerOnboardingPorts';
import { buildDirectProviderModelRegistration } from '../functions/buildDirectProviderModelRegistration';
import { findReusableDirectProviderEndpoint } from '../functions/findReusableDirectProviderEndpoint';
import { listProviderMemberEndpoints } from '../functions/listProviderMemberEndpoints';
import { resolveConfiguredProviderMember } from '../functions/resolveConfiguredProviderMember';
import {
  canRepairUnadmittedProviderModels,
  readProviderCredentialBoundary,
  resolveProviderCredentialReference,
  resolveReusableProviderCredentialPolicy,
} from '../functions/resolveProviderCredentialBoundary';
import { resolveProviderOnboardingAuthMethod } from '../functions/resolveProviderOnboardingAuthMethod';

const logger = getLogger('ProviderOnboarding');

export interface RepairUnadmittedProviderModelsDependencies {
  readonly providerCatalog: ProviderOnboardingCatalogPort;
  readonly discoveredModels: Pick<ProviderModelDiscoveryReadPort, 'readAvailable'>;
  readonly runtimeBindings: ProviderOnboardingRuntimeBindingPort;
  readonly modelCatalog: ProviderOnboardingModelCatalogPort;
  readonly providerConfigurations: ProviderOnboardingConfigurationPort;
  readonly providerAccounts: ProviderOnboardingAccountPort;
  readonly idFactory: ProviderOnboardingIdFactory;
}

/**
 * 按 Provider 当前模型定义重建启动时停用的成员（用户 2026-11-26 定：刷新即修复）。
 *
 * 正式 Provider 拥有成员的模型资料，坏条目里的 route、能力与档位都不可信，所以整条按定义重新生成，
 * 只沿用 model_config_id（归属、选择器偏好与用途绑定都按它引用）。连接按注册同一规则复用，
 * 不匹配时在同一凭据边界内新建，原条目的连接若因此无人引用由 Model Catalog 同一事务回收。
 * 定义里已没有该模型的成员保持停用，只能删除，不猜一个相近的模型代替。
 */
export async function repairUnadmittedProviderModels(
  providerConnectionDefinitionId: string,
  dependencies: RepairUnadmittedProviderModelsDependencies,
  signal?: AbortSignal
): Promise<ProviderModelRepairResult> {
  signal?.throwIfAborted();
  const catalogEntry = dependencies.providerCatalog.getConnection(providerConnectionDefinitionId);
  if (!catalogEntry) {
    throw new ProviderOnboardingError(
      'provider_onboarding.provider_not_found',
      'Provider 不存在',
      404
    );
  }
  const { provider, connection } = catalogEntry;
  const authMethod = resolveProviderOnboardingAuthMethod(connection);
  if (!canRepairUnadmittedProviderModels(connection) || !authMethod) {
    throw new ProviderOnboardingError(
      'provider_onboarding.provider_not_supported',
      '该 Provider 的停用模型不能按定义修复',
      400
    );
  }
  const configuredProvider =
    dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id);
  if (!configuredProvider) return { repaired_model_count: 0, unrepairable_model_count: 0 };
  const unadmittedMembers = configuredProvider.models.filter(
    association =>
      resolveConfiguredProviderMember(association, dependencies.modelCatalog).kind === 'unadmitted'
  );
  if (unadmittedMembers.length === 0) {
    return { repaired_model_count: 0, unrepairable_model_count: 0 };
  }

  const binding = dependencies.runtimeBindings.get(connection.id);
  if (!binding) {
    throw new ProviderOnboardingError(
      'provider_onboarding.runtime_binding_missing',
      '该 Provider 尚未通过运行时准入',
      500
    );
  }
  const providerAccountId =
    authMethod === 'provider_account'
      ? dependencies.providerAccounts.findConnectedAccountId(connection.id)
      : undefined;
  if (authMethod === 'provider_account' && !providerAccountId) {
    throw new ProviderOnboardingError(
      'provider_onboarding.authorization_required',
      `请先完成 ${connection.display_name} 登录`,
      400
    );
  }
  // 与刷新同一资料来源：本次在线发现成功的候选优先，否则用安装包内的目录。
  const effectiveModels =
    dependencies.discoveredModels.readAvailable(connection.id) ?? connection.models;

  let repairedModelCount = 0;
  let unrepairableModelCount = 0;
  for (const association of unadmittedMembers) {
    // 只在两条完整修复之间取消，不中断进行中的目录事务。
    signal?.throwIfAborted();
    const providerModel = effectiveModels.find(model => model.id === association.provider_model_id);
    if (!providerModel) {
      unrepairableModelCount += 1;
      continue;
    }
    const modelBinding = resolveProviderOnboardingModelRuntimeBinding(binding, providerModel.id);
    // 每条都重新读取：上一条修复可能新建了连接，后面同一路由的成员应复用它。
    const memberEndpoints = listProviderMemberEndpoints(
      configuredProvider,
      dependencies.modelCatalog
    );
    const boundary = readProviderCredentialBoundary(memberEndpoints, authMethod);
    const reusableEndpoint = findReusableDirectProviderEndpoint(
      memberEndpoints,
      modelBinding,
      resolveReusableProviderCredentialPolicy(providerAccountId, boundary)
    );
    const plan = buildDirectProviderModelRegistration({
      modelId: association.model_config_id,
      endpointResourceId: reusableEndpoint?.id ?? dependencies.idFactory.create(),
      providerModel,
      binding: modelBinding,
      credentialReference: resolveProviderCredentialReference({
        providerAccountId,
        boundary,
        configuredProviderId: configuredProvider.id,
      }),
      reusableEndpoint,
    });
    await dependencies.modelCatalog.replaceUnadmittedUserModel(plan.model, plan.inferenceEndpoint);
    repairedModelCount += 1;
  }
  logger.info('provider_onboarding.unadmitted_models_repaired', {
    provider_definition_id: provider.id,
    provider_connection_definition_id: connection.id,
    repaired_model_count: repairedModelCount,
    unrepairable_model_count: unrepairableModelCount,
  });
  return {
    repaired_model_count: repairedModelCount,
    unrepairable_model_count: unrepairableModelCount,
  };
}
