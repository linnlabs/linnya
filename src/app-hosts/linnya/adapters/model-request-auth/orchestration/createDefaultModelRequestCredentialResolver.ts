import {
  getLinnyaCloudDeviceId,
  isLinnyaCloudClientEnabled,
  modelCatalog,
  type CredentialReference,
  type ModelConfig,
} from 'src/domains/model-catalog';
import {
  providerAccountRequestCredentialResolver,
  type ProviderAccountRequestCredentialResolver,
} from 'src/domains/provider-account';
import {
  ModelRequestCredentialError,
  type ModelRequestCredentialResolver,
} from '../definitions/modelRequestCredential';

interface DefaultCredentialCatalog {
  getModel(modelId: string): ModelConfig | undefined;
  getCredentialReference(modelId: string): CredentialReference | undefined;
  resolveCredential(modelId: string): string | undefined;
}

export interface DefaultModelRequestCredentialResolverDependencies {
  readonly catalog: DefaultCredentialCatalog;
  readonly resolveCloudDeviceId: () => Promise<string | null>;
  readonly providerAccounts: ProviderAccountRequestCredentialResolver;
  readonly linnyaCloudClientEnabled?: boolean;
}

/**
 * 解析 Host 发起一次模型 HTTP 请求所需的凭据。
 *
 * 设备身份是 Linnya Cloud host-managed credential 的组成部分，不属于模型目录快照。
 * 因此 language inference 与 remote token count 必须在各自请求开始时调用同一解析器。
 */
export function createDefaultModelRequestCredentialResolver(
  dependencies: DefaultModelRequestCredentialResolverDependencies = {
    catalog: modelCatalog,
    resolveCloudDeviceId: getLinnyaCloudDeviceId,
    providerAccounts: providerAccountRequestCredentialResolver,
  }
): ModelRequestCredentialResolver {
  return {
    async resolve(request) {
      const credentialReference = dependencies.catalog.getCredentialReference(request.model_id);
      if (credentialReference?.kind === 'provider_account') {
        try {
          const credential = await dependencies.providerAccounts.resolve(
            credentialReference.account_id
          );
          return {
            profile: request.auth_profile,
            secret: credential.access_token,
            request_headers: credential.request_headers,
          };
        } catch {
          throw new ModelRequestCredentialError(
            `Provider account credential is unavailable for model: ${request.model_id}`
          );
        }
      }
      const isLinnyaCloudCredential =
        credentialReference?.kind === 'host_managed' &&
        credentialReference.credential_id === 'linnya-cloud';
      if (
        isLinnyaCloudCredential &&
        !(dependencies.linnyaCloudClientEnabled ?? isLinnyaCloudClientEnabled(process.env))
      ) {
        throw new ModelRequestCredentialError(
          'Linnya Cloud model requests are disabled in source development mode.'
        );
      }
      const secret = dependencies.catalog.resolveCredential(request.model_id)?.trim();
      if (!secret) {
        throw new ModelRequestCredentialError(
          `Model request credential is not configured for model: ${request.model_id}`
        );
      }
      if (!isLinnyaCloudCredential) {
        return { profile: request.auth_profile, secret };
      }
      const deviceId = await dependencies.resolveCloudDeviceId();
      if (!deviceId) {
        throw new ModelRequestCredentialError('Linnya Cloud device identity is unavailable.');
      }
      return {
        profile: request.auth_profile,
        secret,
        request_headers: { 'X-Device-ID': deviceId },
      };
    },
  };
}
