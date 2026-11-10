import type { DocumentPreviewContent } from '@app/schemas';
import type { DocumentPreviewCapability } from '@linnya/plugin-host-contract/backend/documentPreview';
export interface PreviewNode {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly nodeType: string;
  readonly deletedAt: number | null;
}
export interface DocumentPreviewCache {
  read(key: string): Promise<DocumentPreviewContent | null>;
  write(key: string, content: DocumentPreviewContent): Promise<void>;
}
export interface DocumentPreviewDependencies {
  readonly context: unknown;
  readonly readNode: (id: string) => PreviewNode | null;
  readonly readTextSnapshot: (id: string) => string | null;
  readonly resolveProvider: (nodeType: string) => DocumentPreviewCapability | null;
  readonly cache: DocumentPreviewCache;
}
