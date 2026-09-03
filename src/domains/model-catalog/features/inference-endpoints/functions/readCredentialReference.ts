import type { CredentialReference } from '../../../definitions/inferenceEndpoint';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readCredentialReference(value: unknown): CredentialReference | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('credential_reference 必须是对象');
  switch (value.kind) {
    case 'none':
      return { kind: 'none' };
    case 'environment_variable':
      if (typeof value.environment_variable !== 'string' || !value.environment_variable.trim()) {
        throw new Error('environment_variable credential reference 缺少变量名');
      }
      return {
        kind: 'environment_variable',
        environment_variable: value.environment_variable.trim(),
      };
    case 'stored_secret':
      if (typeof value.credential_id !== 'string' || !value.credential_id.trim()) {
        throw new Error('stored_secret credential reference 缺少 credential_id');
      }
      return { kind: 'stored_secret', credential_id: value.credential_id.trim() };
    case 'provider_account':
      if (typeof value.account_id !== 'string' || !value.account_id.trim()) {
        throw new Error('provider_account credential reference 缺少 account_id');
      }
      return { kind: 'provider_account', account_id: value.account_id.trim() };
    case 'host_managed':
      if (value.credential_id !== 'linnya-cloud') {
        throw new Error('未知 host_managed credential reference');
      }
      return { kind: 'host_managed', credential_id: 'linnya-cloud' };
    default:
      throw new Error('未知 credential_reference kind');
  }
}
