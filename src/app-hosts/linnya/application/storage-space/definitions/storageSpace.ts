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

export interface StorageSpaceOverview {
  readonly measuredAtMs: number;
  readonly total: StorageSpaceUsage;
  readonly categories: readonly StorageSpaceCategoryUsage[];
}
