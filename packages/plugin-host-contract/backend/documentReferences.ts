import type { DocumentBacklink, DocumentReferenceRetainedIdentity, DocumentReferenceResolution, ReplaceDocumentReferencesInput } from '@app/schemas';
import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

/** 必须传入当前提交所用连接，调用方拥有事务与提交时机。 */
export declare function replaceDocumentReferences(
  db: PluginSqliteDatabaseLike,
  input: ReplaceDocumentReferencesInput,
  options?: { readonly retainedReferences?: readonly DocumentReferenceRetainedIdentity[] },
): void;
export declare function listDocumentBacklinks(
  db: PluginSqliteDatabaseLike,
  targetDocumentId: string,
): readonly DocumentBacklink[];
export declare function resolveDocumentReference(
  db: PluginSqliteDatabaseLike,
  input: { readonly sourceDocumentId: string; readonly targetDocumentId: string },
): DocumentReferenceResolution;

export interface DocumentReferenceMarkdownRuntime {
  project(input: { readonly sourceDocumentId: string; readonly content: import('@app/schemas').JsonValue }): { readonly content: import('@app/schemas').JsonValue; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[]; readonly unprojectableReferenceIds: readonly string[] };
  registerBindings(input: { readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[]; readonly unprojectableReferenceIds: readonly string[] }): void;
  hydrate(input: { readonly content: import('@app/schemas').JsonValue; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[] }): import('@app/schemas').JsonValue;
  registerRead(input: { readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string; readonly content: import('@app/schemas').JsonValue }): { readonly content: import('@app/schemas').JsonValue; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[]; readonly unprojectableReferenceIds: readonly string[] };
  admit(input: { readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string; readonly content: import('@app/schemas').JsonValue; readonly existingContent?: import('@app/schemas').JsonValue }): { readonly content: import('@app/schemas').JsonValue; readonly references: readonly import('@app/schemas').DocumentReferenceInput[]; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[] };
  assertBindings(input: { readonly sourceDocumentId: string; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[] }): void;
  clearReader(readerId: string): void;
}
export declare function createDocumentReferenceMarkdownRuntime(db: Pick<PluginSqliteDatabaseLike, 'prepare'>): DocumentReferenceMarkdownRuntime;

export declare class DocumentReferenceMarkdownError extends Error {
  readonly code: 'reference_read_required' | 'reference_projection_lossy' | 'reference_path_changed' | 'reference_path_not_found' | 'reference_source_unavailable';
}
