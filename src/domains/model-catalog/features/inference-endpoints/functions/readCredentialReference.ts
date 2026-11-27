import type { CredentialReference } from '../../../definitions/inferenceEndpoint';
import { isRecord } from '@linnya/foundation';
import { ModelAdmissionError } from '../../../definitions/modelAdmissionError';

export function readCredentialReference(value: unknown): CredentialReference | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new ModelAdmissionError('credential_declaration', 'credential_reference 必须是对象');
  switch (value.kind) {
    case 'none':
      return { kind: 'none' };
    case 'environment_variable':
      if (typeof value.environment_variable !== 'string' || !value.environment_variable.trim()) {
        throw new ModelAdmissionError(
          'credential_declaration',
          'environment_variable credential reference 缺少变量名'
        );
      }
      return {
        kind: 'environment_variable',
        environment_variable: value.environment_variable.trim(),
      };
    case 'stored_secret':
      if (typeof value.credential_id !== 'string' || !value.credential_id.trim()) {
        throw new ModelAdmissionError(
          'credential_declaration',
          'stored_secret credential reference 缺少 credential_id'
        );
      }
      return { kind: 'stored_secret', credential_id: value.credential_id.trim() };
    case 'provider_account':
      if (typeof value.account_id !== 'string' || !value.account_id.trim()) {
        throw new ModelAdmissionError(
          'credential_declaration',
          'provider_account credential reference 缺少 account_id'
        );
      }
      return { kind: 'provider_account', account_id: value.account_id.trim() };
    default:
      throw new ModelAdmissionError('credential_declaration', '未知 credential_reference kind');
  }
}
