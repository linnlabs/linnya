import type { InferenceEndpointView } from 'src/domains/model-catalog';
import type {
  CustomApiProviderEndpointDecision,
  DecideCustomApiProviderEndpointInput,
} from '../definitions/customApiProviderEndpointDecision';

function isCredentialUsable(endpoint: InferenceEndpointView): boolean {
  return (
    endpoint.credential_status === 'configured' || endpoint.credential_status === 'not_required'
  );
}

/**
 * 决定一次分组连接编辑落到哪个 endpoint。
 *
 * 编辑只能影响该分组的模型：被其他模型共享的 endpoint 不在原位改 Key；地址或格式变化总是新建
 * endpoint，旧 endpoint 在没有引用后由 Model Catalog 同事务清理。
 */
export function decideCustomApiProviderEndpoint(
  input: DecideCustomApiProviderEndpointInput
): CustomApiProviderEndpointDecision {
  const [onlyEndpoint] = input.groupEndpoints;
  const connectionUnchanged =
    input.groupEndpoints.length === 1 &&
    onlyEndpoint !== undefined &&
    onlyEndpoint.route_profile_id === input.binding.route_profile_id &&
    onlyEndpoint.base_url === input.baseUrl &&
    onlyEndpoint.auth_profile === input.binding.auth_profile;

  if (connectionUnchanged) {
    const endpointExclusive =
      !input.otherGroupEndpointIds.has(onlyEndpoint.id) &&
      input.catalogModels.every(
        model =>
          model.inference_endpoint_id !== onlyEndpoint.id || input.groupModelIds.has(model.id)
      );
    // 不同 endpoint 也可能沿用同一凭据；换 Key 必须同时隔离 endpoint 与 credential 两层引用。
    const reference = onlyEndpoint.credential_reference;
    const credentialExclusive =
      reference.kind === 'stored_secret' &&
      input.catalogEndpoints.every(
        endpoint =>
          endpoint.id === onlyEndpoint.id ||
          endpoint.credential_reference.kind !== 'stored_secret' ||
          endpoint.credential_reference.credential_id !== reference.credential_id
      );
    if (input.hasNewSecret && endpointExclusive && credentialExclusive)
      return { kind: 'keep', endpoint: onlyEndpoint };
    if (!input.hasNewSecret) {
      return isCredentialUsable(onlyEndpoint)
        ? { kind: 'keep', endpoint: onlyEndpoint }
        : { kind: 'credential_required' };
    }
  }

  if (input.hasNewSecret) return { kind: 'create_with_secret' };

  const firstReference = onlyEndpoint?.credential_reference;
  const sharesOneUsableCredential =
    firstReference?.kind === 'stored_secret' &&
    input.groupEndpoints.every(
      endpoint =>
        endpoint.credential_reference.kind === 'stored_secret' &&
        endpoint.credential_reference.credential_id === firstReference.credential_id &&
        isCredentialUsable(endpoint)
    );
  return sharesOneUsableCredential
    ? { kind: 'create_with_credential', credential_reference: firstReference }
    : { kind: 'credential_required' };
}
