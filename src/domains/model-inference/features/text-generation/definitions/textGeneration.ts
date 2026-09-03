import type { CanonicalLlmUsage } from 'linnkit/contracts';

export type TextGenerationImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export type TextGenerationContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image';
      readonly mediaType: TextGenerationImageMediaType;
      readonly bytes: Uint8Array;
    };

export type TextGenerationMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: readonly TextGenerationContentBlock[] };

export interface TextGenerationRequest {
  readonly modelId: string;
  readonly messages: readonly TextGenerationMessage[];
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  readonly signal?: AbortSignal;
}

export type TextGenerationFinishReason = 'stop' | 'length' | 'content_filter';

export interface TextGenerationResult {
  readonly text: string;
  readonly reasoning: string;
  readonly finishReason: TextGenerationFinishReason;
  readonly usage?: CanonicalLlmUsage;
}

export type TextGenerationFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';

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

export interface TextGenerationPort {
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
}
