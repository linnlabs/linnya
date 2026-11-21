import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { CANVAS_EDITING_CLAIM_TTL_MS } from '../../../../shared';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasEditingClaims, releaseCanvasEditingClaims, updateCanvasEditingClaim } from '..';
const databases: Database.Database[] = [];
function fixture() {
  const database = new Database(':memory:'); databases.push(database); database.pragma('foreign_keys = ON'); database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  for (const id of ['doc', 'other']) { database.prepare('INSERT INTO workspace_nodes VALUES (?)').run(id); initializeCanvasDocument(database, id); }
  const claim = (documentId: string, viewId: string, now: number) => updateCanvasEditingClaim(database, { documentId, viewId, elementId: 'c1', fields: ['data'], now });
  const views = () => (database.prepare('SELECT node_id, view_id FROM canvas_editing_claims ORDER BY node_id, view_id').all() as { node_id: string; view_id: string }[]).map(row => `${row.node_id}/${row.view_id}`);
  return { database, claim, views };
}
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
it('释放视图时一并清理其他视图崩溃后遗留的过期编辑保护，未过期的保留', () => {
  const f = fixture();
  f.claim('doc', 'crashed', 1);
  f.claim('other', 'crashed-elsewhere', 2);
  f.claim('doc', 'alive', 9_000);
  f.claim('doc', 'closing', 9_000);
  const now = 1 + CANVAS_EDITING_CLAIM_TTL_MS + 1_000;
  expect(f.views()).toEqual(['doc/alive', 'doc/closing', 'doc/crashed', 'other/crashed-elsewhere']);
  releaseCanvasEditingClaims(f.database, 'closing', now);
  expect(f.views()).toEqual(['doc/alive']);
  expect(readCanvasEditingClaims(f.database, { documentId: 'doc', viewId: 'reader', now })).toEqual([{ elementId: 'c1', fields: ['data'] }]);
});
it('恰好到期的编辑保护已不再生效，同样被清理', () => {
  const f = fixture();
  f.claim('doc', 'edge', 5);
  releaseCanvasEditingClaims(f.database, 'nobody', 5 + CANVAS_EDITING_CLAIM_TTL_MS - 1);
  expect(f.views()).toEqual(['doc/edge']);
  releaseCanvasEditingClaims(f.database, 'nobody', 5 + CANVAS_EDITING_CLAIM_TTL_MS);
  expect(f.views()).toEqual([]);
});
