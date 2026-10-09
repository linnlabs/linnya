import type { WorkspaceFileLocator } from '@app/schemas';

export type ResearchDocumentSubmissionPresentationData = {
  readonly kind: 'lifecycle';
} | {
  readonly kind: 'saved';
  readonly artifactPath: WorkspaceFileLocator;
};
