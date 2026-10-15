import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { ModelReasoningResolver } from '../../../definitions/modelReasoningResolver';
import { isAutomaticModelReasoning } from '../../catalog-admission';

/** 自动能力不是用户配置；只保存与当前自动结果不同的显式约束和默认值。 */
export function projectUserModelForPersistence(
  model: ModelConfig,
  resolver: ModelReasoningResolver | undefined
): ModelConfig {
  return isAutomaticModelReasoning(model, resolver) ? { ...model, reasoning: undefined } : model;
}
