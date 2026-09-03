export type AutomaticConversationTitleCandidate =
  | { readonly status: 'eligible' }
  | {
      readonly status: 'generating';
      readonly generationId: string;
      readonly userText: string;
    };

export interface AutomaticConversationTitleSource {
  readonly conversationId: string;
  readonly userText: string;
}

export type ConversationTitleOrigin = 'fallback' | 'automatic' | 'explicit';

export interface ConversationTitleCandidatePort {
  getCandidate(conversationId: string): AutomaticConversationTitleCandidate | null;
  registerCandidate(conversationId: string): void;
  claimCandidate(
    conversationId: string,
    generationId: string,
    userText: string,
  ): boolean;
  releaseCandidate(conversationId: string): void;
  isCurrentGeneration(conversationId: string, generationId: string): boolean;
  clearCandidates(): void;
}

export interface ConversationTitleCoordinatorDependencies {
  readonly candidates: ConversationTitleCandidatePort;
  readonly isAutomaticTitleEnabled: () => boolean;
  readonly createGenerationId: () => string;
  readonly generateTitle: (
    conversationId: string,
    userText: string,
    generationId: string,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly persistTitle: (conversationId: string, title: string) => Promise<void>;
  readonly commitTitle: (
    conversationId: string,
    title: string,
    origin: ConversationTitleOrigin,
  ) => void;
  readonly reportFallbackPersistenceFailure: (
    conversationId: string,
    error: unknown,
  ) => void;
  readonly reportGenerationFailure: (conversationId: string, error: unknown) => void;
}

export interface ConversationTitleCoordinator {
  registerAutomaticCandidate(conversationId: string): void;
  handleUserMessage(source: AutomaticConversationTitleSource): Promise<void>;
  sealForSubsequentUserAction(conversationId: string): void;
  renameConversation(conversationId: string, title: string): Promise<void>;
  discardConversation(conversationId: string): void;
  reset(): void;
}
