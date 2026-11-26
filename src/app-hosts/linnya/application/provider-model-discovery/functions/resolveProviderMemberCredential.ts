import type { ModelCatalog, UnadmittedUserModel } from 'src/domains/model-catalog';
import {
  findFirstCatalogedProviderMember,
  type ConfiguredProvider,
} from 'src/domains/provider-configuration';

export interface ProviderMemberCredentialCatalog
  extends Pick<
    ModelCatalog,
    | 'getModel'
    | 'resolveCredential'
    | 'getInferenceEndpoints'
    | 'resolveInferenceEndpointCredential'
  > {
  getUnadmittedUserModels(): readonly UnadmittedUserModel[];
}

/**
 * 读取正式 Provider 的 Key：优先取第一个仍在运行目录里的成员，排在前面的停用成员不能让整个 Provider 显得没有凭据；
 * 成员全部停用时取停用成员仍在的连接。同一正式 Provider 的连接共用一份凭据，
 * 否则“刷新修复”会在最需要它的场景（全部成员停用）里先因读不到 Key 失败。
 */
export function resolveProviderMemberCredential(
  configured: ConfiguredProvider,
  models: ProviderMemberCredentialCatalog
): string | undefined {
  const cataloged = findFirstCatalogedProviderMember(configured, modelConfigId =>
    models.getModel(modelConfigId)
  )?.model;
  if (cataloged) return models.resolveCredential(cataloged.id);
  const memberIds = new Set(configured.models.map(association => association.model_config_id));
  const endpointIds = new Set(models.getInferenceEndpoints().map(endpoint => endpoint.id));
  const unadmittedEndpointId = models
    .getUnadmittedUserModels()
    .find(
      entry =>
        entry.id !== undefined &&
        memberIds.has(entry.id) &&
        entry.inference_endpoint_id !== undefined &&
        endpointIds.has(entry.inference_endpoint_id)
    )?.inference_endpoint_id;
  return unadmittedEndpointId
    ? models.resolveInferenceEndpointCredential(unadmittedEndpointId)
    : undefined;
}
