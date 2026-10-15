import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { ModelReasoningResolver } from '../../../definitions/modelReasoningResolver';
import { readReasoningConfig } from './readReasoningConfig';
import { resolveModelReasoningConfig } from './resolveModelReasoningConfig';

function reasoningEquals(
  left: ModelReasoningConfig | undefined,
  right: ModelReasoningConfig | undefined
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.default_effort === right.default_effort &&
    left.supported_efforts.length === right.supported_efforts.length &&
    left.supported_efforts.every((effort, index) => effort === right.supported_efforts[index])
  );
}

/** 与自动结果完全相等即按派生值处理；不推测此值的历史来源。 */
export function isAutomaticModelReasoning(
  model: ModelConfig,
  resolver: ModelReasoningResolver | undefined
): boolean {
  if (!model.reasoning) return false;
  return reasoningEquals(
    model.reasoning,
    resolveModelReasoningConfig({
      modelName: model.model_name,
      route: model.inference_route,
      resolver,
    })
  );
}

/** 原样带回的旧身份自动结果不是新声明，否则改模型或协议会把旧档位固化成约束。 */
export function readModelReasoningDeclaration(
  declared: unknown,
  previousModel: ModelConfig | undefined,
  resolver: ModelReasoningResolver | undefined
): unknown {
  if (
    previousModel &&
    reasoningEquals(readReasoningConfig(declared), previousModel.reasoning) &&
    isAutomaticModelReasoning(previousModel, resolver)
  ) {
    return undefined;
  }
  return declared;
}
