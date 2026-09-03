import { llm, type ToolModelInputCapabilityValidatorPort } from 'linnkit/runtime-kernel';
import { defaultModelCatalog } from '../runtime-assembly/modelCatalog';

/** 把 host model catalog 收窄成 ToolNode 所需的同步能力门禁。 */
export function createToolModelInputCapabilityValidator(
  modelCatalog: llm.ModelCatalogLike = defaultModelCatalog
): ToolModelInputCapabilityValidatorPort {
  return {
    evaluate(input) {
      return llm.evaluateModelInputCompatibility(
        modelCatalog.getModelById(input.activeModelId),
        input.requirement
      );
    },
    assertCompatible(input) {
      llm.assertModelInputCompatibility({
        modelCatalog,
        modelId: input.activeModelId,
        requirement: input.requirement,
      });
    },
  };
}
