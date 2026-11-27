import {
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
  readonly providerAccounts: ProviderAccountRequestCredentialResolver;
}

/**
 * 解析 Host 发起一次模型 HTTP 请求所需的凭据。
 *
 * Provider account 的 access token 会过期刷新，必须在每次请求开始时解析；language inference
 * 与 remote token count 共用这一个解析器，不各自读取凭据。
 */
export function createDefaultModelRequestCredentialResolver(
  dependencies: DefaultModelRequestCredentialResolverDependencies = {
    catalog: modelCatalog,
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
      const secret = dependencies.catalog.resolveCredential(request.model_id)?.trim();
      if (!secret) {
        throw new ModelRequestCredentialError(
          `Model request credential is not configured for model: ${request.model_id}`
        );
      }
      return { profile: request.auth_profile, secret };
    },
  };
}
