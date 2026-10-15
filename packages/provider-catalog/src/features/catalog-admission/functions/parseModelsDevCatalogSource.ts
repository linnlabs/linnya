import { z } from 'zod';
import { ModelsDevSourceSchema, type ModelsDevSource } from '../definitions/modelsDevSource';
import { PROVIDER_ADMISSION_POLICIES } from '../registry/providerAdmissionPolicies';

const SourceEnvelopeSchema = z.record(z.string().trim().min(1), z.unknown());

/** 发布同步只接纳 policy 选择的供应商；无关供应商的协议变化不应阻断整份目录。 */
export function parseModelsDevCatalogSource(source: unknown): ModelsDevSource {
  const providers = SourceEnvelopeSchema.parse(source);
  const sourceProviderIds = new Set(
    PROVIDER_ADMISSION_POLICIES.flatMap(policy =>
      policy.source_provider_id ? [policy.source_provider_id] : []
    )
  );
  // 已选供应商仍使用完整 schema；缺失项由生成器按相同 policy 明确拒绝，不补旧资料。
  return ModelsDevSourceSchema.parse(
    Object.fromEntries(Object.entries(providers).filter(([id]) => sourceProviderIds.has(id)))
  );
}
