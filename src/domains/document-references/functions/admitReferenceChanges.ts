import type { DocumentReferenceInput } from '@app/schemas';
import { DocumentReferenceError, type ReferenceNode } from '../definitions/documentReferences';

export interface ReferenceChangeCandidate {
  readonly reference: DocumentReferenceInput;
  readonly existingTargetId: string | undefined;
  readonly target: ReferenceNode | null;
}
/** 全批准入先于任何 DELETE/INSERT；拒绝时原正文和关系都保持不变。 */
export function admitReferenceChanges(source: ReferenceNode | null, candidates: readonly ReferenceChangeCandidate[]): void {
  if (!source || source.deletedAt !== null || source.nodeType === 'folder') throw new DocumentReferenceError('source_not_found');
  const seen = new Set<string>();
  for (const { reference, existingTargetId, target } of candidates) {
    if (seen.has(reference.referenceId)) throw new DocumentReferenceError('duplicate_reference');
    seen.add(reference.referenceId);
    if (existingTargetId !== undefined) {
      if (existingTargetId !== reference.targetDocumentId) throw new DocumentReferenceError('reference_retargeted');
      continue;
    }
    if (!target || target.deletedAt !== null || target.nodeType === 'folder') throw new DocumentReferenceError('target_not_found');
    if (!source.projectId || source.projectId !== target.projectId) throw new DocumentReferenceError('outside_project');
  }
}
