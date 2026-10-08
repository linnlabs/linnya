import type { ProviderModelDefinition } from '../../../definitions/providerCatalog';
import { ModelsDevProviderSchema } from '../definitions/modelsDevSource';
import { PROVIDER_ADMISSION_POLICIES } from '../registry/providerAdmissionPolicies';
import { projectModelsDevProviderMetadata } from './projectModelsDevProviderModels';
import { readModelsDevProvider } from './readModelsDevProvider';

function isSourceRecord(source: unknown): source is Record<string, unknown> {
  return typeof source === 'object' && source !== null && !Array.isArray(source);
}

/**
 * Host 用供应商实时模型 ID 查询容量与能力，不能将资料目录当作可用模型列表。
 * 不生成 runtime binding，也不要求历史绑定模型仍出现在本次资料中。
 */
export function projectLiveProviderModelMetadata(
  connectionId: string,
  source: unknown
): readonly ProviderModelDefinition[] {
  const policy = PROVIDER_ADMISSION_POLICIES.find(
    candidate =>
      (candidate.provider_connection_definition_id ?? candidate.provider_definition_id) ===
      connectionId
  );
  if (!policy) {
    throw new Error(`Provider Catalog 未知 connection: ${connectionId}`);
  }
  if (!policy.source_provider_id) {
    throw new Error(`Provider connection 没有 models.dev 资料来源: ${connectionId}`);
  }
  const sourceProviderId = policy.source_provider_id;
  if (!isSourceRecord(source) || !Object.prototype.hasOwnProperty.call(source, sourceProviderId)) {
    throw new Error(`models.dev 缺少已准入 Provider: ${sourceProviderId}`);
  }
  // 只解析选中的原始对象；不能先 parse 整份 source，否则无关供应商会阻断用户刷新。
  const provider = readModelsDevProvider(
    ModelsDevProviderSchema.parse(source[sourceProviderId]),
    sourceProviderId
  );
  return projectModelsDevProviderMetadata(provider, policy);
}
