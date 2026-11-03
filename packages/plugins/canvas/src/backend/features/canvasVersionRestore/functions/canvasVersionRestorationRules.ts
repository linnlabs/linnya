import { isDeepStrictEqual } from 'node:util';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import { CanvasSnapshotSchema, type CanvasElement, type CanvasSnapshot } from '../../../../shared';
import { validateCanvasGraph, type CanvasEditingClaim, type CanvasElementChange } from '../../canvasCommit';

const commitMetadataFields = new Set(['revision', 'updatedBy', 'updatedAt']);

/** 相同正文与位置不因历史修订号不同而再次写入。提交元数据由本次用户恢复生成。 */
export function canvasVersionRestorationFields(current: CanvasElement, target: CanvasElement): string[] {
  return [...new Set([...Object.keys(current), ...Object.keys(target)])].filter(field =>
    !commitMetadataFields.has(field) && !isDeepStrictEqual(Reflect.get(current, field), Reflect.get(target, field)));
}

export function assertCanvasVersionRestorationClaims(change: CanvasElementChange, claims: readonly CanvasEditingClaim[]): void {
  const conflict = claims.some(claim => claim.elementId === change.id && claim.fields.length > 0 &&
    (!change.before || !change.after || claim.fields.some(field => field === '$existence' || change.fields.includes(field))));
  if (conflict) throw new DocumentHistoryError('version_conflict');
}

export function assertCanvasVersionRestorationTarget(snapshot: CanvasSnapshot): CanvasSnapshot {
  const parsed = CanvasSnapshotSchema.safeParse(snapshot);
  if (!parsed.success || parsed.data.integrity || new Set(parsed.data.elements.map(element => element.id)).size !== parsed.data.elements.length) {
    throw new DocumentHistoryError('version_corrupt');
  }
  try { validateCanvasGraph(parsed.data.elements); }
  catch { throw new DocumentHistoryError('version_corrupt'); }
  return parsed.data;
}
