import type { CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type {
  InferenceModelCatalog,
  ResolvedInferenceAttemptRoute,
} from '../definitions/inferenceCapability';
import {
  INFERENCE_ADMISSION_ERROR_CODES,
  InferenceAdmissionError,
} from '../definitions/inferenceAdmissionError';

function assertToolContract(request: CanonicalInferenceRequest): void {
  const names = new Set<string>();
  for (const tool of request.tools) {
    if (names.has(tool.name)) {
      throw new InferenceAdmissionError(
        INFERENCE_ADMISSION_ERROR_CODES.DUPLICATE_TOOL_NAME,
        `Inference request contains duplicate tool name: ${tool.name}`
      );
    }
    names.add(tool.name);
  }

  if (typeof request.tool_choice === 'object' && !names.has(request.tool_choice.name)) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.TOOL_CHOICE_UNKNOWN,
      `Selected tool is not present in this inference request: ${request.tool_choice.name}`
    );
  }
}

function assertImagePlacement(
  request: CanonicalInferenceRequest,
  route: ResolvedInferenceAttemptRoute
): void {
  for (const message of request.messages) {
    if (message.role !== 'user' && message.role !== 'tool') continue;
    const hasImage = message.content.some(block => block.type === 'image');
    if (!hasImage) continue;

    const supported =
      message.role === 'user'
        ? route.input_support.user_image
        : route.input_support.tool_result_image;
    if (!supported) {
      throw new InferenceAdmissionError(
        INFERENCE_ADMISSION_ERROR_CODES.IMAGE_PLACEMENT_UNSUPPORTED,
        `Inference route does not support ${message.role} image input.`
      );
    }
  }
}

export function resolveInferenceAttemptRoute(
  catalog: InferenceModelCatalog,
  request: CanonicalInferenceRequest
): ResolvedInferenceAttemptRoute {
  const model = catalog.getModel(request.model_id);
  if (!model) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.MODEL_NOT_FOUND,
      `Inference model is not registered: ${request.model_id}`
    );
  }
  if (!model.capabilities.includes('chat')) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.MODEL_NOT_CHAT,
      `Model does not declare the chat capability: ${request.model_id}`
    );
  }
  if (!model.inference_route) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.ROUTE_MISSING,
      `Chat model has no inference route: ${request.model_id}`
    );
  }

  const routeProfileId = catalog.getInferenceRouteProfileId(model.id);
  if (!routeProfileId) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.ROUTE_MISSING,
      `Chat model has no resolvable inference route profile: ${request.model_id}`
    );
  }

  const route: ResolvedInferenceAttemptRoute = {
    model_id: model.id,
    route_profile_id: routeProfileId,
    ...model.inference_route,
  };
  const requestedOutputTokens = request.sampling.max_output_tokens;
  if (requestedOutputTokens !== undefined && requestedOutputTokens > route.max_output_tokens) {
    throw new InferenceAdmissionError(
      INFERENCE_ADMISSION_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED,
      `Requested max output tokens exceed the route limit: ${requestedOutputTokens} > ${route.max_output_tokens}`
    );
  }

  assertToolContract(request);
  assertImagePlacement(request, route);
  return route;
}
