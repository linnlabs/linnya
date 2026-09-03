import type { ProviderAccountModelDefinition } from 'src/domains/provider-account';
import type { ProviderModelDefinition } from '@linnya/provider-catalog';

/** 把账号目录的瞬时模型事实投影为 onboarding 可消费的统一模型合同。 */
export function projectProviderAccountModelDefinition(
  model: ProviderAccountModelDefinition
): ProviderModelDefinition {
  return {
    ...model,
    release_status: 'active',
  };
}
