import type { DocumentReferenceRetainedIdentity, ReplaceDocumentReferencesInput } from '@app/schemas';
import type { PluginSqliteDatabaseLike } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import { createDocumentReferenceMarkdownRuntime as createMarkdownRuntime, createDocumentReferenceOperations, type ReferenceDatabase } from 'src/domains/document-references';
import { readWorkspaceDocumentLocation, resolveWorkspaceDocumentPath, readWorkspaceDocumentIdentity } from './workspaceDocumentProjection';

interface ReferenceStatement { all(...values: readonly unknown[]): unknown[]; run(...values: readonly unknown[]): unknown }
function isReferenceStatement(value: unknown): value is ReferenceStatement {
  return typeof value === 'object' && value !== null && 'all' in value && typeof value.all === 'function' && 'run' in value && typeof value.run === 'function';
}
function operations(db: PluginSqliteDatabaseLike) {
  // SQLite 提交者必须显式持有同一事务；不能另开连接让引用落在正文之外。
  const port: ReferenceDatabase = {
    get inTransaction() { return 'inTransaction' in db && db.inTransaction === true; },
    prepare(sql) {
      const statement: unknown = db.prepare(sql);
      if (!isReferenceStatement(statement)) throw new Error('Document references require readable and writable statements');
      return statement;
    },
  };
  return createDocumentReferenceOperations(port, { read: id => readWorkspaceDocumentIdentity(db, id) });
}
export function replaceDocumentReferences(db: PluginSqliteDatabaseLike, input: ReplaceDocumentReferencesInput, options: { readonly retainedReferences?: readonly DocumentReferenceRetainedIdentity[] } = {}): void {
  operations(db).replace(input, options);
}
export function listDocumentBacklinks(db: PluginSqliteDatabaseLike, targetDocumentId: string) {
  return operations(db).listBacklinks(targetDocumentId);
}
export function resolveDocumentReference(db: PluginSqliteDatabaseLike, input: { readonly sourceDocumentId: string; readonly targetDocumentId: string }) {
  return operations(db).resolve(input);
}

/** 实例由调用方持有；可信 CLI read/show 登记与写入使用同一实例。 */
export function createDocumentReferenceMarkdownRuntime(db: Pick<PluginSqliteDatabaseLike, 'prepare'>) {
  return createMarkdownRuntime({ read: documentId => readWorkspaceDocumentIdentity(db, documentId), location: documentId => readWorkspaceDocumentLocation(db, documentId), resolvePath: (projectId, path) => resolveWorkspaceDocumentPath(db, { projectId, path }) });
}

export { ReferenceMarkdownError as DocumentReferenceMarkdownError } from 'src/domains/document-references';
