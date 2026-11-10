import type { Component } from 'vue';
import type { DocumentReferencePresentation } from '@app/schemas';
import type { DocumentPreviewTarget } from './documentPreview';
export interface DocumentPreviewMountPorts {
  currentProjectId(): string | null;
  read(target: DocumentPreviewTarget): Promise<DocumentReferencePresentation>;
  load(): Promise<Component>;
}
export interface DocumentPreviewMountOwnership {
  readonly dispose: () => void;
}
