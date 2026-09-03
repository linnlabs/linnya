export const STORAGE_SPACE_CATEGORY_KINDS = [
  'conversation_work_files',
  'workspace',
  'attachments',
  'temporary_outputs',
  'diagnostic_logs',
  'application_data',
] as const;

export type StorageSpaceCategoryKind = typeof STORAGE_SPACE_CATEGORY_KINDS[number];

export interface StorageSpaceUsage {
  readonly byteSize: number;
  readonly fileCount: number;
}

export interface StorageSpaceCategoryUsage extends StorageSpaceUsage {
  readonly kind: StorageSpaceCategoryKind;
}

export interface ManagedStorageInventory {
  readonly total: StorageSpaceUsage;
  readonly categories: readonly StorageSpaceCategoryUsage[];
}

interface StorageSpaceConversationUsageIdentity {
  readonly conversationId: string;
  readonly title: string;
  readonly projectId: string | null;
  readonly lastEventAt: number;
}

export type StorageSpaceConversationUsage = StorageSpaceConversationUsageIdentity & (
  | (StorageSpaceUsage & {
    readonly workFilesState: 'not_created' | 'previous_files_unavailable' | 'available';
  })
  | {
    readonly workFilesState: 'unavailable';
    readonly byteSize: null;
    readonly fileCount: null;
  }
);

export interface StorageSpaceOverview {
  readonly measuredAtMs: number;
  readonly total: StorageSpaceUsage;
  readonly categories: readonly StorageSpaceCategoryUsage[];
  readonly conversations: readonly StorageSpaceConversationUsage[];
}
