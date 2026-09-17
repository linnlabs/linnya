import type { MarkdownRevisionSnapshot } from '@app/schemas';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface MarkdownDocumentSessionPorts {
  readonly setDirty: (dirty: boolean) => void;
  readonly reportError: (error: unknown) => void;
  readonly onSnapshotInstalled?: () => void;
  readonly loadBaseline?: (document: ProseMirrorNode) => void;
}

export interface MarkdownDocumentSession {
  readonly documentId: string;
  readonly setDirty: (dirty: boolean) => void;
  readonly reportError: (error: unknown) => void;
  readonly onSnapshotInstalled: () => void;
  readonly loadBaseline: (document: ProseMirrorNode) => void;
  snapshot: MarkdownRevisionSnapshot | null;
  baseline: ProseMirrorNode | null;
}
