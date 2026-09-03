import type { CredentialReference, ModelConfig } from 'src/domains/model-catalog';

import type {
  ModelRuntimeAvailability,
  ModelRuntimeAvailabilityContext,
  ModelRuntimeAvailabilityInput,
  SelectableModelCapability,
} from '../definitions/modelRuntimeAvailability';

function unavailable(
  reason: Exclude<ModelRuntimeAvailability, { readonly available: true }>['reason'],
): ModelRuntimeAvailability {
  return { available: false, reason };
}

function routeAuthProfile(
  model: ModelConfig,
  capability: SelectableModelCapability,
): 'none' | 'bearer' | 'api_key' | undefined {
  return capability === 'chat'
    ? model.inference_route?.auth_profile
    : model.image_generation_route?.auth_profile;
}

function credentialReferenceAvailable(
  reference: CredentialReference,
  modelConfigId: string,
  context: ModelRuntimeAvailabilityContext,
): boolean {
  // `auth_profile=none` 已在调用方提前接纳；其余 route 的 none 表示缺少凭据。
  if (reference.kind === 'none') return false;
  if (reference.kind === 'provider_account') {
    return context.hasProviderAccountCredential(reference.account_id);
  }
  return context.hasModelCredential(modelConfigId);
}

/**
 * 判断一个已经物化的 ModelConfig 能否承担指定产品用途。
 *
 * 路由、endpoint 和 credential 分属不同 owner；这里是唯一的应用层组合点，
 * Model Picker、CLI 查询与 CLI admission 应复用同一结论，避免“能选但不能跑”。
 */
export function evaluateModelRuntimeAvailability(
  input: ModelRuntimeAvailabilityInput,
): ModelRuntimeAvailability {
  const { model, capability, context } = input;
  if (!model.capabilities.includes(capability)) return unavailable('capability_missing');

  const authProfile = routeAuthProfile(model, capability);
  if (!authProfile) return unavailable('route_missing');

  if (model.inference_endpoint_id) {
    const endpoint = context.inferenceEndpoints.find(
      candidate => candidate.id === model.inference_endpoint_id,
    );
    if (!endpoint) return unavailable('route_missing');
    if (endpoint.credential_reference.kind === 'provider_account') {
      return context.hasProviderAccountCredential(
        endpoint.credential_reference.account_id,
      )
        ? { available: true }
        : unavailable('credential_missing');
    }
    return endpoint.credential_status === 'missing'
      ? unavailable('credential_missing')
      : { available: true };
  }

  if (authProfile === 'none') return { available: true };
  if (!model.credential_reference) return unavailable('credential_missing');

  return credentialReferenceAvailable(
    model.credential_reference,
    model.id,
    context,
  )
    ? { available: true }
    : unavailable('credential_missing');
}

/** Model Picker 的单一 available 标记表示至少一种可选用途当前能够运行。 */
export function isModelRuntimeAvailable(
  model: ModelConfig,
  context: ModelRuntimeAvailabilityContext,
): boolean {
  const selectableCapabilities: readonly SelectableModelCapability[] = [
    'chat',
    'image_generation',
  ];
  const declaredCapabilities = selectableCapabilities.filter(capability =>
    model.capabilities.includes(capability),
  );
  if (declaredCapabilities.length > 0) {
    return declaredCapabilities.some(
      capability => evaluateModelRuntimeAvailability({ model, capability, context }).available,
    );
  }

  if (model.inference_endpoint_id) {
    const endpoint = context.inferenceEndpoints.find(
      candidate => candidate.id === model.inference_endpoint_id,
    );
    if (!endpoint) return false;
    if (endpoint.credential_reference.kind === 'provider_account') {
      return context.hasProviderAccountCredential(endpoint.credential_reference.account_id);
    }
    return endpoint.credential_status !== 'missing';
  }
  if (!model.credential_reference) return context.hasModelCredential(model.id);
  return credentialReferenceAvailable(model.credential_reference, model.id, context);
}
