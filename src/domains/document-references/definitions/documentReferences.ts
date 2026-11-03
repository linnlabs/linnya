import type { DocumentReferenceResolution } from '@app/schemas';

export interface ReferenceNode {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly nodeType: string;
  readonly deletedAt: number | null;
}
export interface ReferenceNodePort {
  read(documentId: string): ReferenceNode | null;
}
export interface ReferenceDatabase {
  readonly inTransaction: boolean;
  prepare(sql: string): {
    all(...values: readonly unknown[]): unknown[];
    run(...values: readonly unknown[]): unknown;
  };
}
export class DocumentReferenceError extends Error {
  constructor(readonly code: 'transaction_required' | 'source_not_found' | 'target_not_found' | 'outside_project' | 'duplicate_reference' | 'reference_retargeted') {
    super(`Document reference: ${code}`);
    this.name = 'DocumentReferenceError';
  }
}
export interface ReferenceResolutionInput {
  readonly sourceDocumentId: string;
  readonly targetDocumentId: string;
}
export type ReferenceResolution = DocumentReferenceResolution;
