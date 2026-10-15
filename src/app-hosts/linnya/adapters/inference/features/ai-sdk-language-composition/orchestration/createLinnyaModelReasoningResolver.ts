import type { ModelReasoningResolver } from 'src/domains/model-catalog';
import { createLinnyaAiSdkLanguageModelRegistry } from './createLinnyaAiSdkLanguageModelRegistry';

/** 由 Host 连接目录准入与 SDK 能力，目录本身不依赖 Provider package。 */
export function createLinnyaModelReasoningResolver(): ModelReasoningResolver {
  const languageModels = createLinnyaAiSdkLanguageModelRegistry();
  return route => {
    // mock 等非 SDK capability 不在该能力来源中，也不能按模型名借用另一种协议。
    const factory = languageModels.entries.find(entry => entry.capability_id === route.capability_id);
    if (!factory) return undefined;
    return languageModels.resolveModelReasoning({
      capability_id: factory.capability_id,
      endpoint_model_id: route.endpoint_model_id,
    });
  };
}
