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
