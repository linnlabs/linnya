import type { AnyAgentEvent } from '../../../events/agentEvents';
import type {
  LlmInputMaterializerPort,
  LlmRequestMessage,
  ResolvedLlmInputMessage,
} from '../../../../ports';
import {
  ErrorClassifier,
} from '../../../../shared/errorClassifier';
import {
  assertModelInputCompatibility,
  deriveModelInputRequirement,
  mergeModelInputRequirements,
  MODEL_INPUT_ERROR_CODES,
  ModelInputCapabilityError,
  type ModelInputRequirement,
} from '../../input-capabilities';
import type { ModelCatalogLike } from '../../modelCatalog';
import type { LlmCallInvocationContext } from '../../definitions/llmCallInvocationContext';
import { createLlmAgentErrorEvent } from '../../functions/createLlmAgentErrorEvent';
import { liftTextOnlyLlmInput } from '../functions/liftTextOnlyLlmInput';

function createMaterializationPendingError(
  activeModelId: string,
  requirement: ModelInputRequirement,
): ModelInputCapabilityError {
  return new ModelInputCapabilityError(
    MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
    'Image input materialization is not available in this runtime.',
    {
      active_model_id: activeModelId,
      required_placements: requirement.placements,
      missing_conditions: ['materialization_pending'],
    },
  );
}

async function materializeLlmInput(params: {
  readonly activeModelId: string;
  readonly messages: readonly LlmRequestMessage[];
  readonly requirement: ModelInputRequirement;
  readonly materializer?: LlmInputMaterializerPort;
  readonly invocationContext?: LlmCallInvocationContext;
}): Promise<ResolvedLlmInputMessage[]> {
  if (!params.requirement.requires_image_input) {
    return liftTextOnlyLlmInput(params.activeModelId, params.messages);
  }

  const admissionEvidence = params.invocationContext?.imageInputAdmissionEvidence;
  if (!params.materializer || !admissionEvidence) {
    throw createMaterializationPendingError(params.activeModelId, params.requirement);
  }

  return params.materializer.materialize({
    activeModelId: params.activeModelId,
    messages: params.messages,
    admissionEvidence,
  });
}

/**
 * provider attempt 之前的唯一输入门禁。
 *
 * 中文备注：本地失败必须分类并发出一次稳定事件，但不能进入 provider retry/fallback，
 * 因此不能复用发送请求后的 catch 分支。
 */
export async function runLlmInputPreflight(params: {
  readonly activeModelId: string;
  readonly messages: readonly LlmRequestMessage[];
  readonly modelCatalog: ModelCatalogLike;
  readonly materializer?: LlmInputMaterializerPort;
  readonly invocationContext?: LlmCallInvocationContext;
  readonly eventHandler?: (event: AnyAgentEvent) => void;
  readonly requirement?: ModelInputRequirement;
}): Promise<ResolvedLlmInputMessage[]> {
  try {
    const messageRequirement = deriveModelInputRequirement(params.messages);
    const requirement = params.requirement ?? mergeModelInputRequirements(
      messageRequirement,
      params.invocationContext?.additionalModelInputRequirement,
    );
    assertModelInputCompatibility({
      modelCatalog: params.modelCatalog,
      modelId: params.activeModelId,
      requirement,
    });
    return await materializeLlmInput({
      activeModelId: params.activeModelId,
      messages: params.messages,
      // 只有消息中实际存在附件时才物化；工具 requirement 只参与模型兼容判断。
      requirement: messageRequirement,
      materializer: params.materializer,
      invocationContext: params.invocationContext,
    });
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const classification = ErrorClassifier.classify(normalizedError, {
      logPrefix: '[LlmCaller:preflight]',
    });
    params.eventHandler?.(createLlmAgentErrorEvent(normalizedError, classification));
    throw normalizedError;
  }
}
