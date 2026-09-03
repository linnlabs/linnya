import { RuntimeResourceRefs, type RuntimeResourceRef } from '../../../../contracts';
import type { ModelInputRequirement } from '../../../llm/input-capabilities';
import type { ToolExecutionContext } from '../../toolExecutionContext';
import type { ToolModelInputCapabilityValidatorPort } from '../../ports';
import {
  ToolModelInputResolutionError,
  type ToolModelInputAttachmentSelection,
  type ToolModelInputResolverPort,
} from '../definitions/toolModelInput';

const TOOL_RESULT_IMAGE_REQUIREMENT: ModelInputRequirement = {
  requires_image_input: true,
  placements: ['tool_result_image'],
};

export async function resolveToolModelInput(input: {
  readonly activeModelId: string | undefined;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly selections: readonly ToolModelInputAttachmentSelection[] | undefined;
  readonly context: ToolExecutionContext;
  readonly resolver?: ToolModelInputResolverPort;
  readonly capabilityValidator?: ToolModelInputCapabilityValidatorPort;
}): Promise<readonly RuntimeResourceRef[] | undefined> {
  if (!input.selections) {
    return undefined;
  }
  if (!input.resolver) {
    throw new ToolModelInputResolutionError('Tool model input resolver is not configured.');
  }

  const resolved = await input.resolver.resolveToolModelInput({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    selections: input.selections,
    context: input.context,
  });
  const parsed = RuntimeResourceRefs.safeParse(resolved);
  if (!parsed.success || parsed.data.length !== input.selections.length) {
    throw new ToolModelInputResolutionError('Tool model input resolver returned an invalid attachment batch.');
  }
  if (parsed.data.some((reference, index) => reference.id !== input.selections?.[index]?.id)) {
    throw new ToolModelInputResolutionError('Tool model input resolver changed attachment identity or order.');
  }
  if (!input.activeModelId) {
    throw new ToolModelInputResolutionError('Missing successful LLM model for tool input validation.');
  }
  if (!input.capabilityValidator) {
    throw new ToolModelInputResolutionError('Tool model input validator is not configured.');
  }
  input.capabilityValidator.assertCompatible({
    activeModelId: input.activeModelId,
    requirement: TOOL_RESULT_IMAGE_REQUIREMENT,
  });

  return Object.freeze(parsed.data.map(reference => Object.freeze(reference)));
}
