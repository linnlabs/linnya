export interface ManagedImageMaintenanceLogger {
  warn(message: string): void;
}

export interface ManagedImagePendingRecoveryStats {
  readonly scanned: number;
  readonly completed: number;
  readonly quarantined: number;
  readonly quarantineDeleted: number;
  readonly failed: number;
}

export interface OrphanManagedImageAssetStats {
  readonly deletedAssets: number;
  readonly deletedFiles: number;
  readonly failedFiles: number;
}
