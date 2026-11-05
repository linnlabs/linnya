export interface ManagedImageStoragePaths {
  readonly managedRoot: string;
  readonly stagingRoot: string;
  readonly contentRoot: string;
  /** contentRoot 相对 AppData Root 的持久路径，是 `assets.local_path` 的前缀。 */
  readonly contentStoragePath: string;
}

export interface ManagedImageWritableStoragePaths extends ManagedImageStoragePaths {
  readonly pendingRoot: string;
  readonly quarantineRoot: string;
}

export interface ManagedContentPendingPublish {
  readonly receiptPath: string;
}

/** @deprecated 使用 ManagedContentPendingPublish。 */
export type ManagedImagePendingPublish = ManagedContentPendingPublish;

export class ManagedContentPublishError extends Error {
  readonly name = 'ManagedContentPublishError';

  constructor(readonly code: 'content_address_conflict') {
    super(code);
  }
}

/** @deprecated 使用 ManagedContentPublishError。 */
export { ManagedContentPublishError as ManagedImagePublishError };
