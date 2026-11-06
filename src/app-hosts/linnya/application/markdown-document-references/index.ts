import type Database from 'better-sqlite3';
import { createDocumentReferenceOperations, collectDocumentReferenceInputs } from 'src/domains/document-references';
import { createDocumentReferenceMarkdownRuntime } from 'src/plugin-sdk/backend/documentReferences';
import { readWorkspaceDocumentIdentity } from 'src/plugin-sdk/backend/workspaceDocumentProjection';
import { bindMarkdownDocumentReferences } from 'src/domains/markdown/features/document-references';

const runtimes = new WeakMap<Database.Database, ReturnType<typeof createDocumentReferenceMarkdownRuntime>>();
/** 可信 read_file 投递与 file write 使用同一数据库实例，绝不按模型输入创建读取凭据。 */
export function getMarkdownDocumentReferenceRuntime(db: Database.Database) {
  const previous = runtimes.get(db); if (previous) return previous;
  const runtime = createDocumentReferenceMarkdownRuntime(db);
  runtimes.set(db, runtime); return runtime;
}
export function bindMarkdownDocumentReferenceCapabilities(db: Database.Database): void {
  const runtime = getMarkdownDocumentReferenceRuntime(db);
  const operations = createDocumentReferenceOperations(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
  bindMarkdownDocumentReferences(db, { ...runtime,
    replace(documentId, references, retained) { operations.replace({ sourceDocumentId: documentId, references: [...references] }, { retainedReferences: retained.map(({ referenceId, targetDocumentId }) => ({ referenceId, targetDocumentId })) }); },
  });
}
export { collectDocumentReferenceInputs };

export { selectDeliveredReferenceBindings } from './functions/selectDeliveredReferenceBindings';
