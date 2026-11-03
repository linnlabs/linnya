import type { DocumentBacklink, DocumentReferenceResolution, ReplaceDocumentReferencesInput } from '@app/schemas';
import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

/** 必须传入当前提交所用连接，调用方拥有事务与提交时机。 */
export declare function replaceDocumentReferences(
  db: PluginSqliteDatabaseLike,
  input: ReplaceDocumentReferencesInput,
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
  registerRead(input: { readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string; readonly content: import('@app/schemas').JsonValue }): { readonly content: import('@app/schemas').JsonValue; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[]; readonly unprojectableReferenceIds: readonly string[] };
  admit(input: { readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string; readonly content: import('@app/schemas').JsonValue; readonly existingContent?: import('@app/schemas').JsonValue }): { readonly content: import('@app/schemas').JsonValue; readonly references: readonly import('@app/schemas').DocumentReferenceInput[]; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[] };
  assertBindings(input: { readonly sourceDocumentId: string; readonly bindings: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[] }): void;
  clearReader(readerId: string): void;
}
export declare function createDocumentReferenceMarkdownRuntime(db: Pick<PluginSqliteDatabaseLike, 'prepare'>): DocumentReferenceMarkdownRuntime;
