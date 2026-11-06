import { CANVAS_EDITING_CLAIM_TTL_MS } from '../../../../shared';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type { CanvasEditingClaim } from '../definitions/canvasCommit';

/** 整个视图的保护原子替换；长拖 500 卡与单卡编辑使用同一事务、同一续约期限。 */
export function replaceCanvasEditingClaims(database: CanvasDatabase, input: {
  readonly documentId: string;
  readonly viewId: string;
  readonly claims: readonly CanvasEditingClaim[];
  readonly now: number;
}): void {
  const remove = database.prepare('DELETE FROM canvas_editing_claims WHERE node_id = ? AND view_id = ?');
  const insert = database.prepare('INSERT INTO canvas_editing_claims (node_id, view_id, element_id, fields_json, expires_at) VALUES (?, ?, ?, ?, ?)');
  database.transaction(() => {
    remove.run(input.documentId, input.viewId);
    for (const claim of input.claims) if (claim.fields.length) {
      insert.run(input.documentId, input.viewId, claim.elementId, JSON.stringify(claim.fields), input.now + CANVAS_EDITING_CLAIM_TTL_MS);
    }
  }).immediate();
}
