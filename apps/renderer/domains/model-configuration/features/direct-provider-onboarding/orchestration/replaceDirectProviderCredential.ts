import type {
  DirectProviderCredentialGateway,
  DirectProviderCredentialReplacementResult,
} from '../definitions/directProviderCredentialReplacement';
import { httpDirectProviderCredentialGateway } from '../infrastructure/httpDirectProviderCredentialGateway';

/** 单向提交新 Key；Renderer 不保存、不回显，也不决定替换哪个 credential boundary。 */
export async function replaceDirectProviderCredential(
  providerConnectionDefinitionId: string,
  apiKey: string,
  gateway: DirectProviderCredentialGateway = httpDirectProviderCredentialGateway
): Promise<DirectProviderCredentialReplacementResult> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) return { ok: false, issue: 'api_key_required' };
  await gateway.replaceCredential({
    provider_connection_definition_id: providerConnectionDefinitionId,
    api_key: normalizedApiKey,
  });
  return { ok: true };
}
