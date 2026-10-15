import type {
  CredentialReference,
  InferenceEndpoint,
  InferenceEndpointSelection,
} from '../../../definitions/inferenceEndpoint';
import { readInferenceEndpoint } from '../functions/readInferenceEndpoint';
import { endpointCredentialStore } from './endpointCredentialStore';

/**
 * 解析一次用户模型写入的 endpoint selection，并先完成必要的凭据写入。
 *
 * 返回的 rollback 只撤销本次凭据变更；调用方在目录写盘失败时必须调用它。
 */
export async function prepareInferenceEndpointSelection(
  selection: InferenceEndpointSelection,
  nextEndpoints: Map<string, InferenceEndpoint>
): Promise<{ readonly endpoint: InferenceEndpoint; rollback(): Promise<void> }> {
  let endpoint: InferenceEndpoint;
  let createdCredentialId: string | undefined;
  let replacedCredential: { readonly id: string; readonly previousPlaintext?: string } | undefined;

  if (selection.kind === 'existing') {
    const selected = nextEndpoints.get(selection.inference_endpoint_id);
    if (!selected) throw new Error(`InferenceEndpoint 不存在: ${selection.inference_endpoint_id}`);
    endpoint = selected;
    const replacementSecret = selection.credential_secret?.trim();
    if (replacementSecret) {
      if (endpoint.credential_reference.kind !== 'stored_secret') {
        throw new Error(`InferenceEndpoint ${endpoint.id} 不接受本地凭据替换`);
      }
      const credentialId = endpoint.credential_reference.credential_id;
      replacedCredential = {
        id: credentialId,
        previousPlaintext: endpointCredentialStore.has(credentialId)
          ? endpointCredentialStore.resolve(credentialId)
          : undefined,
      };
      await endpointCredentialStore.put(credentialId, replacementSecret);
    } else if (
      endpoint.credential_reference.kind === 'stored_secret' &&
      !endpointCredentialStore.has(endpoint.credential_reference.credential_id)
    ) {
      throw new Error(`InferenceEndpoint ${endpoint.id} 的凭据不可用`);
    }
  } else {
    const input = selection.endpoint;
    if (nextEndpoints.has(input.id)) throw new Error(`InferenceEndpoint 已存在: ${input.id}`);
    const credentialReference: CredentialReference =
      input.credential_reference ??
      (input.auth_profile === 'none'
        ? { kind: 'none' }
        : { kind: 'stored_secret', credential_id: `inference-endpoint:${input.id}` });
    endpoint = readInferenceEndpoint({
      ...input,
      credential_reference: credentialReference,
    });
    if (credentialReference.kind === 'stored_secret') {
      const credentialId = credentialReference.credential_id;
      const credentialSecret = input.credential_secret?.trim();
      const credentialExists = endpointCredentialStore.has(credentialId);
      if (!credentialSecret && !credentialExists) {
        throw new Error('需要认证的 InferenceEndpoint 缺少 credential secret');
      }
      if (credentialSecret) {
        if (credentialExists) {
          replacedCredential = {
            id: credentialId,
            previousPlaintext: endpointCredentialStore.resolve(credentialId),
          };
        } else {
          createdCredentialId = credentialId;
        }
        await endpointCredentialStore.put(credentialId, credentialSecret);
      }
    }
    nextEndpoints.set(endpoint.id, endpoint);
  }

  return {
    endpoint,
    async rollback() {
      if (createdCredentialId) await endpointCredentialStore.remove(createdCredentialId);
      if (!replacedCredential) return;
      if (replacedCredential.previousPlaintext === undefined) {
        await endpointCredentialStore.remove(replacedCredential.id);
      } else {
        await endpointCredentialStore.put(
          replacedCredential.id,
          replacedCredential.previousPlaintext
        );
      }
    },
  };
}
