export interface PreparedTableFillRun {
  conversationId: string;
  runId: string;
  messageId: string;
  projectId: string;
  projectMetadata: { id: string };
  wasNewConversation: boolean;
}

export type PrepareTableFillRunResult =
  | { ok: true; run: PreparedTableFillRun }
  | { ok: false; reason: 'cancelled' }
  | {
      ok: false;
      reason: 'conversation-missing' | 'project-missing';
      message: string;
    };
