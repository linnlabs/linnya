import type { RendererAiInvocationUserQuote } from './aiInvocationPort';

export interface RendererStructuredContextRequirementInput {
  readonly prompt: string;
  readonly options: {
    readonly context?: {
      readonly contextBefore?: string;
      readonly contextAfter?: string;
    };
    readonly documentFragment?: string;
    readonly fences?: readonly {
      readonly kind: string;
      readonly content: string;
      readonly attrs?: Record<string, unknown>;
      readonly metadata?: Record<string, unknown>;
    }[];
    readonly userQuote?: RendererAiInvocationUserQuote;
  };
}

export type RendererStructuredContextRequirementResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface RendererStructuredContextRequirement {
  readonly id: string;
  validate(input: RendererStructuredContextRequirementInput): RendererStructuredContextRequirementResult;
}

export declare function registerRendererStructuredContextRequirement(
  requirement: RendererStructuredContextRequirement,
): void;
export declare function unregisterRendererStructuredContextRequirement(id: string): void;
export declare function validateRendererStructuredContextRequirements(
  input: RendererStructuredContextRequirementInput,
): RendererStructuredContextRequirementResult;
export declare function clearRendererStructuredContextRequirementsForTest(): void;
