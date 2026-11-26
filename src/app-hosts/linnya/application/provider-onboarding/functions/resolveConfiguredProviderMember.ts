import type { ModelConfig } from 'src/domains/model-catalog';
import type {
  ConfiguredProvider,
  ConfiguredProviderModel,
} from 'src/domains/provider-configuration';

import { ProviderOnboardingError } from '../definitions/providerOnboardingError';
import type { ProviderOnboardingModelCatalogPort } from '../definitions/providerOnboardingPorts';

type ProviderMemberCatalog = Pick<
  ProviderOnboardingModelCatalogPort,
  'getModel' | 'getUnadmittedUserModels'
>;

export type ConfiguredProviderMember =
  | {
      readonly kind: 'cataloged';
      readonly association: ConfiguredProviderModel;
      readonly model: ModelConfig;
    }
  /**
   * 启动时停用（未通过准入）的用户模型：保留归属、等待修复或删除。
   * 接入用例不拿它判断凭据边界，也不刷新、同步或清理它。
   */
  | { readonly kind: 'unadmitted'; readonly association: ConfiguredProviderModel };

/**
 * 把 Provider 的一条归属对应到模型目录。
 * 归属只可能指向运行目录里的模型或停用条目（启动对账已删掉其余的）；两者都不是，
 * 说明归属与目录在运行中失去一致，按配置损坏报错，不能悄悄跳过。
 */
export function resolveConfiguredProviderMember(
  association: ConfiguredProviderModel,
  catalog: ProviderMemberCatalog
): ConfiguredProviderMember {
  const model = catalog.getModel(association.model_config_id);
  if (model) return { kind: 'cataloged', association, model };
  const unadmitted = catalog
    .getUnadmittedUserModels()
    .some(entry => entry.id === association.model_config_id);
  if (unadmitted) return { kind: 'unadmitted', association };
  throw new ProviderOnboardingError(
    'provider_onboarding.configuration_invalid',
    'Provider 配置引用的模型或推理连接无效',
    500
  );
}

/** Provider 里仍在运行目录中的成员模型，按归属顺序；停用成员不参与凭据边界与连接复用。 */
export function listCatalogedProviderModels(
  provider: ConfiguredProvider,
  catalog: ProviderMemberCatalog
): ModelConfig[] {
  return provider.models.flatMap(association => {
    const member = resolveConfiguredProviderMember(association, catalog);
    return member.kind === 'cataloged' ? [member.model] : [];
  });
}
