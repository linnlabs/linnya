export const MANAGED_IMAGE_STORAGE_KIND = 'managed_image_v2' as const;

export interface ManagedImageStoreBinding {
  readonly storeId: string;
}

export class ManagedImageStoreBindingError extends Error {
  readonly name = 'ManagedImageStoreBindingError';

  constructor(readonly code: 'invalid_store_id' | 'binding_missing') {
    super(`Managed image store binding failed: ${code}`);
  }
}
