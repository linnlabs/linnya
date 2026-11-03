import { z } from 'zod';
import { ReplaceDocumentReferencesInputSchema, type DocumentBacklink, type ReplaceDocumentReferencesInput } from '@app/schemas';
import { DocumentReferenceError, type ReferenceDatabase, type ReferenceNodePort, type ReferenceResolutionInput } from '../../../definitions/documentReferences';
import { admitReferenceChanges } from '../../../functions/admitReferenceChanges';
import { resolveReferenceStatus } from '../../../functions/resolveReferenceStatus';

const rowSchema = z.object({ source_document_id: z.string(), reference_id: z.string(), target_document_id: z.string(), kind: z.string() });

export function createDocumentReferenceOperations(db: ReferenceDatabase, nodes: ReferenceNodePort) {
  return {
    replace(input: ReplaceDocumentReferencesInput): void {
      const parsed = ReplaceDocumentReferencesInputSchema.parse(input);
      if (!db.inTransaction) throw new DocumentReferenceError('transaction_required');
      const source = nodes.read(parsed.sourceDocumentId);
      const existing = z.array(rowSchema).parse(db.prepare('SELECT * FROM document_references WHERE source_document_id = ?').all(parsed.sourceDocumentId));
      const byReferenceId = new Map(existing.map(row => [row.reference_id, row.target_document_id]));
      admitReferenceChanges(source, parsed.references.map(reference => ({
        reference,
        existingTargetId: byReferenceId.get(reference.referenceId),
        target: nodes.read(reference.targetDocumentId),
      })));
      db.prepare('DELETE FROM document_references WHERE source_document_id = ?').run(parsed.sourceDocumentId);
      const insert = db.prepare('INSERT INTO document_references(source_document_id, reference_id, target_document_id, kind) VALUES (?, ?, ?, ?)');
      for (const reference of parsed.references) insert.run(parsed.sourceDocumentId, reference.referenceId, reference.targetDocumentId, reference.kind);
    },
    listBacklinks(targetDocumentId: string): readonly DocumentBacklink[] {
      const rows = z.array(rowSchema).parse(db.prepare('SELECT * FROM document_references WHERE target_document_id = ? ORDER BY source_document_id, reference_id').all(targetDocumentId));
      const result: DocumentBacklink[] = [];
      for (const row of rows) {
        const source = nodes.read(row.source_document_id);
        if (!source || source.deletedAt !== null) continue;
        result.push({ sourceDocumentId: source.id, sourceTitle: source.name, sourceNodeType: source.nodeType, referenceId: row.reference_id, targetDocumentId: row.target_document_id, kind: row.kind });
      }
      return result;
    },
    resolve(input: ReferenceResolutionInput) {
      return resolveReferenceStatus(nodes.read(input.sourceDocumentId), nodes.read(input.targetDocumentId), input.targetDocumentId);
    },
  };
}
