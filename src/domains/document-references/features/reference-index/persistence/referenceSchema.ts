import type { ISchemaProvider } from 'src/shared/database/schema-provider';

export const DOCUMENT_REFERENCE_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS document_references (
    source_document_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    target_document_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY(source_document_id, reference_id),
    FOREIGN KEY(source_document_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_document_references_target ON document_references(target_document_id)`,
];
export function getDocumentReferenceSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'document-references', getSchema: () => [...DOCUMENT_REFERENCE_SCHEMAS] }];
}
