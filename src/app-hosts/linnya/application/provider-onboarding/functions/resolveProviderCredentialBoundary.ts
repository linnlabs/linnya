import type { ProviderConnectionDefinition } from '@linnya/provider-catalog';
import type { CredentialReference, InferenceEndpointView } from 'src/domains/model-catalog';

import { ProviderOnboardingError } from '../definitions/providerOnboardingError';
import type { ReusableProviderCredentialPolicy } from './findReusableDirectProviderEndpoint';
import type { ProviderOnboardingAuthMethod } from './resolveProviderOnboardingAuthMethod';

export function isSameCredentialReference(
  left: CredentialReference,
  right: CredentialReference
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'none':
      return true;
    case 'environment_variable':
      return (
        right.kind === 'environment_variable' &&
        left.environment_variable === right.environment_variable
      );
    case 'stored_secret':
      return right.kind === 'stored_secret' && left.credential_id === right.credential_id;
    case 'provider_account':
      return right.kind === 'provider_account' && left.account_id === right.account_id;
    case 'host_managed':
      return right.kind === 'host_managed' && left.credential_id === right.credential_id;
  }
}

/**
 * 同一正式 Provider connection 的全部 endpoint 共享一条凭据边界；返回它，没有 endpoint 时为 undefined。
 * 注册新模型与按定义修复停用成员都从这里取边界，保证修复不会给同一 Provider 造出第二份 Key。
 */
export function readProviderCredentialBoundary(
  endpoints: readonly InferenceEndpointView[],
  authMethod: ProviderOnboardingAuthMethod
): CredentialReference | undefined {
  const reference = endpoints[0]?.credential_reference;
  if (
    reference &&
    endpoints.some(endpoint => !isSameCredentialReference(endpoint.credential_reference, reference))
  ) {
    throw new ProviderOnboardingError(
      'provider_onboarding.configuration_invalid',
      'Provider 配置存在多个凭据边界',
      500
    );
  }
  if (authMethod === 'api_key' && reference && reference.kind !== 'stored_secret') {
    throw new ProviderOnboardingError(
      'provider_onboarding.configuration_invalid',
      'Provider 配置的凭据边界无效',
      500
    );
  }
  return reference;
}

/** 新建 endpoint 时引用的凭据：账号型用账号，API Key 型沿用已有边界，首次接入按 ConfiguredProvider 生成稳定 ID。 */
export function resolveProviderCredentialReference(input: {
  readonly providerAccountId: string | undefined;
  readonly boundary: CredentialReference | undefined;
  readonly configuredProviderId: string;
}): CredentialReference {
  if (input.providerAccountId) {
    return { kind: 'provider_account', account_id: input.providerAccountId };
  }
  if (input.boundary?.kind === 'stored_secret') return input.boundary;
  return {
    kind: 'stored_secret',
    credential_id: `configured-provider:${input.configuredProviderId}`,
  };
}

/** 可复用 endpoint 的凭据条件；缺失的 Key 不阻止复用，由“更新 API Key”补上。 */
export function resolveReusableProviderCredentialPolicy(
  providerAccountId: string | undefined,
  boundary: CredentialReference | undefined
): ReusableProviderCredentialPolicy {
  return providerAccountId
    ? { kind: 'provider_account', account_id: providerAccountId }
    : {
        kind: 'stored_secret',
        credential_id: boundary?.kind === 'stored_secret' ? boundary.credential_id : undefined,
        allow_missing: true,
      };
}

/**
 * 能否按 Provider 定义重建停用成员：只有模型资料来自 Provider 目录（bundled，可含在线发现）的直连 connection。
 * 账号目录型由账号同步重新注册，本地运行时没有可依据的定义，它们的停用成员只能删除。
 */
export function canRepairUnadmittedProviderModels(
  connection: Pick<ProviderConnectionDefinition, 'kind' | 'model_discovery'>
): boolean {
  return connection.kind === 'direct' && connection.model_discovery === 'bundled';
}
