import type {
  CommandPermissionLevel,
  CommandPermissionSettingsUpdateV1,
  ConversationCommandPermissionChange,
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
  /** 草稿对话第一次被设置档位时落库；对话表的写入归事件库，这里只是转交。 */
  materializeConversation(target: ConversationPermissionTarget, createdAt: number): void;
  /** 写入变更事实并在同一事务里投影成时间线记录行。 */
  writeChange(conversationId: string, change: ConversationCommandPermissionChange): void;
  savePendingReduction(update: CommandPermissionSettingsUpdateV1, changedCount: number): void;
  readPendingReduction(): { update: CommandPermissionSettingsUpdateV1; changedCount: number } | undefined;
  clearPendingReduction(): void;
  transact<T>(write: () => T): T;
}
