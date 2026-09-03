import type { ModelCatalogEntry } from '../../llm/modelCatalog';
import {
  EMPTY_MODEL_INPUT_REQUIREMENT,
  evaluateModelInputCompatibility,
  mergeModelInputRequirements,
  type ModelInputRequirement,
} from '../../llm/input-capabilities';
import type { FunctionToolSchema } from '../../tools/toolContracts';
import type { ToolRuntimeDefinition } from '../../tools/ports';

export interface ModelCompatibleToolPreparation {
  readonly schemas: readonly FunctionToolSchema[];
  readonly requirement: ModelInputRequirement;
}

/**
 * 只过滤带静态 requirement 的工具；动态工具必须等真实结果出现 selection 后再判定。
 */
export function prepareModelCompatibleTools(input: {
  readonly schemas: readonly FunctionToolSchema[];
  readonly model: ModelCatalogEntry | undefined;
  readonly getToolDefinition: (toolName: string) => ToolRuntimeDefinition | undefined;
}): ModelCompatibleToolPreparation {
  const schemas: FunctionToolSchema[] = [];
  const requirements: ModelInputRequirement[] = [];

  for (const schema of input.schemas) {
    const definition = input.getToolDefinition(schema.function.name);
    const requirement = definition?.modelInputRequirement;
    const delivery = definition?.modelInputDelivery ?? 'required';
    const isRequired = delivery === 'required';
    if (
      requirement &&
      isRequired &&
      !evaluateModelInputCompatibility(input.model, requirement).compatible
    ) {
      continue;
    }
    schemas.push(schema);
    // when_supported 附件不会成为本次 LLM 请求的前置要求；否则非视觉模型连工具都看不到。
    if (requirement && isRequired) {
      requirements.push(requirement);
    }
  }

  return {
    schemas: Object.freeze(schemas),
    requirement:
      requirements.length > 0
        ? mergeModelInputRequirements(...requirements)
        : EMPTY_MODEL_INPUT_REQUIREMENT,
  };
}
