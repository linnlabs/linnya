export interface BeginAnnotationRunExecutionInput {
  conversationId: string;
  runId: string;
  controller: AbortController;
}

export interface SettleAnnotationRunExecutionInput {
  controller: AbortController;
  errorMessage: string | null;
}
