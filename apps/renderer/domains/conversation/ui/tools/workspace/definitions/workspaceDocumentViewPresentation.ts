import type { WorkspaceDocumentReadData } from '@app/schemas';

export type WorkspaceDocumentViewPresentationData =
  | {
      readonly kind: 'lifecycle';
    }
  | {
      readonly kind: 'snapshot';
      readonly document: WorkspaceDocumentReadData;
    };
