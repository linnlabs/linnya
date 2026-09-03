import { LANGUAGE_INFERENCE_ROUTE_PROFILES } from '@app/schemas/model-inference';

import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import { readCredentialReference } from './readCredentialReference';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`InferenceEndpoint 缺少 ${key}`);
  return value.trim();
}

export function readInferenceEndpoint(value: unknown): InferenceEndpoint {
  if (!isRecord(value)) throw new Error('InferenceEndpoint 必须是对象');
  const routeProfileId = requiredString(value, 'route_profile_id');
  const profile = LANGUAGE_INFERENCE_ROUTE_PROFILES.find(
    candidate => candidate.id === routeProfileId
  );
  if (!profile) throw new Error(`未知 InferenceEndpoint route profile: ${routeProfileId}`);
  const rawAuthProfile = requiredString(value, 'auth_profile');
  const authProfile = profile.auth_profiles.find(candidate => candidate === rawAuthProfile);
  if (!authProfile) {
    throw new Error('InferenceEndpoint auth_profile 与 route profile 不一致');
  }
  const credentialReference = readCredentialReference(value.credential_reference);
  if (!credentialReference) throw new Error('InferenceEndpoint 缺少 credential_reference');
  if (authProfile === 'none' && credentialReference.kind !== 'none') {
    throw new Error('无认证 InferenceEndpoint 不能绑定 credential');
  }
  if (authProfile !== 'none' && credentialReference.kind === 'none') {
    throw new Error('需要认证的 InferenceEndpoint 必须绑定 credential');
  }
  return {
    id: requiredString(value, 'id'),
    route_profile_id: profile.id,
    endpoint_id: requiredString(value, 'endpoint_id'),
    base_url: requiredString(value, 'base_url').replace(/\/+$/, ''),
    auth_profile: authProfile,
    credential_reference: credentialReference,
  };
}
