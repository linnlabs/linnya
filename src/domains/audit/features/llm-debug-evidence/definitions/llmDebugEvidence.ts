export interface LLMDebugEvidenceContext {
  conversationId: string;
  runId: string;
  traceId?: string;
  subrunId?: string;
  parentToolCallId?: string;
  source?: string;
}

export interface RunTranscriptDebugEvidenceToolset {
  readonly availableTools?: string[];
}

export interface LlmInputMaterializationDebugEvidenceInput {
  readonly activeModelId: string;
  readonly profileId: string;
  readonly estimatorVersion: string;
  readonly apiSurface: string;
  readonly inputBudget: number;
  readonly nonImageEstimatedTokens: number;
  readonly attachmentEvidence: readonly {
    readonly messageIndex: number;
    readonly attachmentIndex: number;
    readonly id: string;
    readonly resourceId: string;
    readonly placement: string;
    readonly mediaType: string;
    readonly byteLength: number;
    readonly width: number;
    readonly height: number;
  }[];
}
