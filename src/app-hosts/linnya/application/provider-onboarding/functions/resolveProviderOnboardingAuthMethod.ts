import type { ProviderConnectionDefinition } from '@linnya/provider-catalog';

export type ProviderOnboardingAuthMethod = 'api_key' | 'provider_account';

/**
 * Provider 的 setup schema 是 onboarding 认证方式的唯一产品真相。
 * 不从 Provider 名称、URL 或 route 猜测，也不接受多个互相冲突的认证入口。
 */
export function resolveProviderOnboardingAuthMethod(
  connection: ProviderConnectionDefinition
): ProviderOnboardingAuthMethod | undefined {
  if (connection.setup_fields.length !== 1) return undefined;
  const [field] = connection.setup_fields;
  if (field?.kind === 'secret' && field.id === 'api_key') return 'api_key';
  if (field?.kind === 'oauth' && field.id === 'authorization') return 'provider_account';
  return undefined;
}
