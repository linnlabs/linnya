import type { TextGenerationFailureKind } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
export type { TextGenerationImageMediaType, TextGenerationContentBlock, TextGenerationMessage, TextGenerationRequest, TextGenerationFinishReason, TextGenerationResult, TextGenerationFailureKind, TextGenerationPort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';

export class TextGenerationFailure extends Error {
  constructor(
    readonly kind: TextGenerationFailureKind,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'TextGenerationFailure';
  }
}
