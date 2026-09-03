export type SharedMemoryWritePresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly documentName?: string;
      readonly contentUnits?: number;
    }
  | {
      readonly kind: 'snapshot';
      readonly documentName: string;
      readonly contentUnits: number;
      readonly action: 'write' | 'append';
      readonly operation: 'create' | 'update';
      readonly version: number;
    };
