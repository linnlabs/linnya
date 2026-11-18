import type {
  CommandPermissionLevel,
  CommandPermissionSettingsUpdateV1,
  ConversationCommandPermissionChange,
  ConversationRunCommandPermission,
  ConversationCommandPermissionRequest,
  ConversationCommandPermissionResult,
  ConversationCommandPermissionSelection,
} from '@app/schemas/commands';

export interface ConversationCommandPermissions {
  readSelection(conversationId: string): ConversationCommandPermissionSelection;
  initializeForNewConversation(target: ConversationPermissionTarget, level: CommandPermissionLevel): Promise<void>;
  request(request: ConversationCommandPermissionRequest): Promise<ConversationCommandPermissionResult>;
}

export interface ConversationPermissionTarget {
  readonly conversation_id: string;
  readonly project_id: string | null;
}

export interface StoredConversationPermissionSelection extends ConversationCommandPermissionSelection {
  readonly conversation_id: string;
  readonly created_at: number;
}

export interface ConversationCommandPermissionPersistencePort {
  loadSelections(): readonly StoredConversationPermissionSelection[];
  resolveTarget(conversationId: string): (ConversationPermissionTarget & { readonly created_at: number }) | null;
  createConversation(target: ConversationPermissionTarget, createdAt: number): void;
  writeChange(conversationId: string, change: ConversationCommandPermissionChange): void;
  readChanges(conversationId: string): ConversationCommandPermissionChange[];
  readLatestRun(conversationId: string): ConversationRunCommandPermission | null;
  savePendingReduction(update: CommandPermissionSettingsUpdateV1, changedCount: number): void;
  readPendingReduction(): { update: CommandPermissionSettingsUpdateV1; changedCount: number } | undefined;
  clearPendingReduction(): void;
  transact<T>(write: () => T): T;
}
