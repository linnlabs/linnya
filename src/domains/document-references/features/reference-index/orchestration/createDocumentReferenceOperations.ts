import { z } from 'zod';
import { DocumentReferenceRetainedIdentitySchema, ReplaceDocumentReferencesInputSchema, type DocumentReferenceRetainedIdentity, type DocumentBacklink, type ReplaceDocumentReferencesInput } from '@app/schemas';
import { DocumentReferenceError, type ReferenceDatabase, type ReferenceNode, type ReferenceNodePort, type ReferenceResolutionInput } from '../../../definitions/documentReferences';
import { admitReferenceChanges } from '../../../functions/admitReferenceChanges';
import { resolveReferenceStatus } from '../../../functions/resolveReferenceStatus';

const rowSchema = z.object({ source_document_id: z.string(), reference_id: z.string(), target_document_id: z.string(), kind: z.string() });

export function createDocumentReferenceOperations(db: ReferenceDatabase, nodes: ReferenceNodePort) {
  return {
    replace(input: ReplaceDocumentReferencesInput, options: { readonly retainedReferences?: readonly DocumentReferenceRetainedIdentity[] } = {}): void {
      const parsed = ReplaceDocumentReferencesInputSchema.parse(input);
      if (!db.inTransaction) throw new DocumentReferenceError('transaction_required');
      const source = nodes.read(parsed.sourceDocumentId);
      const existing = z.array(rowSchema).parse(db.prepare('SELECT * FROM document_references WHERE source_document_id = ?').all(parsed.sourceDocumentId));
      const retained = new Map<string, string>();
      for (const value of options.retainedReferences ?? []) {
        const identity = DocumentReferenceRetainedIdentitySchema.parse(value);
        const previous = retained.get(identity.referenceId);
        if (previous !== undefined && previous !== identity.targetDocumentId) throw new DocumentReferenceError('reference_retargeted');
        retained.set(identity.referenceId, identity.targetDocumentId);
      }
      const byReferenceId = new Map(existing.map(row => [row.reference_id, row.target_document_id]));
      const targets = new Map<string, ReturnType<ReferenceNodePort['read']>>();
      admitReferenceChanges(source, parsed.references.map(reference => {
        const existingTargetId = byReferenceId.get(reference.referenceId) ?? retained.get(reference.referenceId);
        // 既有稳定身份允许目标移出/删除，规则不需要再读目标；新目标在同一事务内只查一次。
        if (existingTargetId === undefined && !targets.has(reference.targetDocumentId)) targets.set(reference.targetDocumentId, nodes.read(reference.targetDocumentId));
        return { reference, existingTargetId, target: targets.get(reference.targetDocumentId) ?? null };
      }));
      const incoming = new Map(parsed.references.map(reference => [reference.referenceId, reference]));
      const remove = db.prepare('DELETE FROM document_references WHERE source_document_id = ? AND reference_id = ?');
      for (const row of existing) if (!incoming.has(row.reference_id)) remove.run(parsed.sourceDocumentId, row.reference_id);
      const previous = new Map(existing.map(row => [row.reference_id, row]));
      const insert = db.prepare('INSERT INTO document_references(source_document_id, reference_id, target_document_id, kind) VALUES (?, ?, ?, ?) ON CONFLICT(source_document_id, reference_id) DO UPDATE SET kind = excluded.kind');
      for (const reference of parsed.references) if (previous.get(reference.referenceId)?.kind !== reference.kind) {
        insert.run(parsed.sourceDocumentId, reference.referenceId, reference.targetDocumentId, reference.kind);
      }
    },
    listBacklinks(targetDocumentId: string): readonly DocumentBacklink[] {
      const target = nodes.read(targetDocumentId);
      if (!target || target.deletedAt !== null || !target.projectId) return [];
      const rows = z.array(rowSchema).parse(db.prepare('SELECT * FROM document_references WHERE target_document_id = ? ORDER BY source_document_id, reference_id').all(targetDocumentId));
      const result: DocumentBacklink[] = [];
      for (const row of rows) {
        const source = nodes.read(row.source_document_id);
        if (!source || source.deletedAt !== null || source.projectId !== target.projectId) continue;
        result.push({ sourceDocumentId: source.id, sourceTitle: source.name, sourceNodeType: source.nodeType, referenceId: row.reference_id, targetDocumentId: row.target_document_id, kind: row.kind });
      }
      return result;
    },
    /** 这份文档引用的、仍在同一项目且不在回收站的文档；同一目标的多处引用合并计数。 */
    listReferences(sourceDocumentId: string): readonly { readonly document: ReferenceNode; readonly referenceCount: number }[] {
      const source = nodes.read(sourceDocumentId);
      if (!source || source.deletedAt !== null || !source.projectId) return [];
      const rows = z.array(z.object({ target_document_id: z.string(), count: z.number() })).parse(db.prepare(
        'SELECT target_document_id, COUNT(*) AS count FROM document_references WHERE source_document_id = ? GROUP BY target_document_id ORDER BY target_document_id',
      ).all(sourceDocumentId));
      return rows.flatMap(row => {
        const target = nodes.read(row.target_document_id);
        return target && target.deletedAt === null && target.projectId === source.projectId ? [{ document: target, referenceCount: row.count }] : [];
      });
    },
    resolve(input: ReferenceResolutionInput) {
      return resolveReferenceStatus(nodes.read(input.sourceDocumentId), nodes.read(input.targetDocumentId), input.targetDocumentId);
    },
  };
}
