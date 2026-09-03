export interface SharedMemoryListPresentationDocument {
  readonly name: string;
  readonly sizeBytes: number;
  readonly updatedAtMs: number;
}

export type SharedMemoryListPresentationData =
  | {
      readonly kind: 'lifecycle';
    }
  | {
      readonly kind: 'snapshot';
      readonly documents: readonly SharedMemoryListPresentationDocument[];
    };
