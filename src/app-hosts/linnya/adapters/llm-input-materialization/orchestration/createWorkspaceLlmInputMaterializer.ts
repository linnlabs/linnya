import {
  LLM_IMAGE_INPUT_ERROR_CODES,
  LlmImageInputError,
} from '@linnlabs/linnkit/runtime-kernel';
import type {
  ImageInputAdmissionEvidence,
  LlmInputMaterializerPort,
  LlmRequestMessage,
  ResolvedLlmImageAttachment,
  ResolvedLlmInputMessage,
} from '@linnlabs/linnkit/ports';
import {
  WorkspaceLlmImageResolutionError,
  type WorkspaceLlmImageResolverPort,
} from 'src/features/workspace/assets/features/llm-image-resolution';
import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';
import type { ImageInputProcessingProfileRegistry } from '../definitions/imageInputProcessingProfileRegistry';
import { recordLlmInputMaterializationEvidence } from 'src/domains/audit';
import {
  collectDurableImageInputs,
  type DurableImageInputPosition,
} from '../functions/collectDurableImageInputs';
import { assertImageInputRouteLimits } from '../functions/assertImageInputRouteLimits';

function failMapping(
  activeModelId: string,
  input: DurableImageInputPosition | undefined,
  message: string,
): never {
  throw new LlmImageInputError(
    LLM_IMAGE_INPUT_ERROR_CODES.MAPPING_UNSUPPORTED,
    message,
    {
      active_model_id: activeModelId,
      ...(input ? {
        placement: input.placement,
        message_id: input.messageId,
        attachment_id: input.reference.id,
        resource_id: input.reference.resourceId,
        message_index: input.messageIndex,
        attachment_index: input.attachmentIndex,
      } : {}),
    },
  );
}

function assertEvidenceMatchesInputs(params: {
  readonly activeModelId: string;
  readonly evidence: ImageInputAdmissionEvidence;
  readonly inputs: readonly DurableImageInputPosition[];
}): void {
  if (params.evidence.attachments.length !== params.inputs.length) {
    failMapping(params.activeModelId, params.inputs[0], 'Image admission evidence does not match final context.');
  }
  params.inputs.forEach((input, index) => {
    const evidence = params.evidence.attachments[index];
    if (
      !evidence
      || evidence.messageIndex !== input.messageIndex
      || evidence.attachmentIndex !== input.attachmentIndex
      || evidence.id !== input.reference.id
      || evidence.resourceId !== input.reference.resourceId
      || evidence.placement !== input.placement
    ) {
      failMapping(params.activeModelId, input, 'Image admission evidence does not match final context.');
    }
  });
}

function assertContextBudget(params: {
  readonly activeModelId: string;
  readonly profile: ImageInputProcessingProfile;
  readonly evidence: ImageInputAdmissionEvidence;
  readonly inputs: readonly DurableImageInputPosition[];
}): void {
  const imageTokens = params.inputs.reduce((total, input) => total + params.profile.estimateTokens({
    width: input.reference.width,
    height: input.reference.height,
  }), 0);
  const actualTokens = params.evidence.nonImageEstimatedTokens + imageTokens;
  if (actualTokens <= params.evidence.inputBudget) return;

  throw new LlmImageInputError(
    LLM_IMAGE_INPUT_ERROR_CODES.CONTEXT_BUDGET_EXCEEDED,
    'Image input exceeds the admitted context budget for the active route.',
    {
      active_model_id: params.activeModelId,
      profile_id: params.profile.id,
      limit_kind: 'context_tokens',
      actual_value: actualTokens,
      limit_value: params.evidence.inputBudget,
    },
  );
}

function mapWorkspaceError(
  error: WorkspaceLlmImageResolutionError,
  activeModelId: string,
  inputs: readonly DurableImageInputPosition[],
): LlmImageInputError {
  const input = inputs.find(candidate => (
    candidate.reference.id === error.attachmentId
    && candidate.reference.resourceId === error.resourceId
  ));
  return new LlmImageInputError(
    error.code === 'attachment_unavailable'
      ? LLM_IMAGE_INPUT_ERROR_CODES.ATTACHMENT_UNAVAILABLE
      : LLM_IMAGE_INPUT_ERROR_CODES.ATTACHMENT_INTEGRITY_FAILED,
    error.message,
    {
      active_model_id: activeModelId,
      ...(input ? {
        placement: input.placement,
        message_id: input.messageId,
        attachment_id: input.reference.id,
        resource_id: input.reference.resourceId,
        message_index: input.messageIndex,
        attachment_index: input.attachmentIndex,
      } : {}),
    },
  );
}

function replaceAttachments(
  messages: readonly LlmRequestMessage[],
  resolved: readonly ResolvedLlmImageAttachment[],
): ResolvedLlmInputMessage[] {
  let offset = 0;
  return messages.map(message => {
    if (!('attachments' in message)) return message;
    const { attachments: durableAttachments, ...messageWithoutDurableAttachments } = message;
    const attachmentCount = durableAttachments?.length ?? 0;
    if (attachmentCount === 0) return messageWithoutDurableAttachments;
    const attachments = resolved.slice(offset, offset + attachmentCount);
    offset += attachmentCount;
    return { ...messageWithoutDurableAttachments, attachments };
  });
}

export function createWorkspaceLlmInputMaterializer(params: {
  readonly profileRegistry: ImageInputProcessingProfileRegistry;
  readonly workspaceResolver: WorkspaceLlmImageResolverPort;
}): LlmInputMaterializerPort {
  return {
    async materialize(attempt): Promise<ResolvedLlmInputMessage[]> {
      const inputs = collectDurableImageInputs(attempt.messages);
      assertEvidenceMatchesInputs({
        activeModelId: attempt.activeModelId,
        evidence: attempt.admissionEvidence,
        inputs,
      });

      const profile = params.profileRegistry.resolveForModel(attempt.activeModelId);
      if (!profile) {
        failMapping(attempt.activeModelId, inputs[0], 'No image input processing profile is registered for the active model route.');
      }
      assertImageInputRouteLimits({ activeModelId: attempt.activeModelId, profile, inputs });
      assertContextBudget({
        activeModelId: attempt.activeModelId,
        profile,
        evidence: attempt.admissionEvidence,
        inputs,
      });

      let verified;
      try {
        verified = await params.workspaceResolver.resolveImages(inputs.map(input => input.reference));
      } catch (error) {
        if (error instanceof WorkspaceLlmImageResolutionError) {
          throw mapWorkspaceError(error, attempt.activeModelId, inputs);
        }
        throw error;
      }
      const resolved = verified.map((image, index): ResolvedLlmImageAttachment => ({
        ...image,
        placement: inputs[index]?.placement ?? failMapping(
          attempt.activeModelId,
          undefined,
          'Workspace image resolution returned an unexpected result count.',
        ),
      }));
      if (resolved.length !== inputs.length) {
        failMapping(attempt.activeModelId, inputs[resolved.length], 'Workspace image resolution returned an unexpected result count.');
      }
      const materializedAttachments = inputs.map((input, index) => {
        const image = resolved[index];
        if (!image) {
          failMapping(
            attempt.activeModelId,
            input,
            'Workspace image resolution returned an unexpected result count.',
          );
        }
        return {
          messageIndex: input.messageIndex,
          attachmentIndex: input.attachmentIndex,
          id: image.id,
          resourceId: image.resourceId,
          placement: image.placement,
          mediaType: image.mediaType,
          byteLength: image.byteLength,
          width: image.width,
          height: image.height,
        };
      });
      recordLlmInputMaterializationEvidence({
        activeModelId: attempt.activeModelId,
        profileId: profile.id,
        estimatorVersion: profile.estimatorVersion,
        apiSurface: profile.apiSurface,
        inputBudget: attempt.admissionEvidence.inputBudget,
        nonImageEstimatedTokens: attempt.admissionEvidence.nonImageEstimatedTokens,
        attachmentEvidence: materializedAttachments,
      });
      return replaceAttachments(attempt.messages, resolved);
    },
  };
}
