import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { releaseDocumentAssetOwnership } from './releaseDocumentAssetOwnership';

it('精确、可重试地解除单文稿归属，不删除共享资产与其他所有者', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    for (const ddl of [...CORE_SCHEMAS, ...ASSET_LEDGER_SCHEMAS]) db.exec(ddl);
    db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('p', 'Test', 1, 1);
    for (const id of ['doc-a', 'doc-b']) db.prepare(`INSERT INTO workspace_nodes(id,project_id,type,name,created_at,updated_at)
      VALUES (?,'p','presentation',?,1,1)`).run(id, id);
    for (const id of ['shared', 'keep']) db.prepare(`INSERT INTO assets(id,uri,storage_status,created_at)
      VALUES (?,?,'ready',1)`).run(id, `asset:${id}`);
    db.prepare('INSERT INTO document_asset_links(document_node_id,asset_id) VALUES (?,?)').run('doc-a', 'shared');
    db.prepare('INSERT INTO document_asset_links(document_node_id,asset_id) VALUES (?,?)').run('doc-b', 'shared');
    db.prepare('INSERT INTO document_asset_links(document_node_id,asset_id) VALUES (?,?)').run('doc-a', 'keep');
    releaseDocumentAssetOwnership(db, 'doc-a', ['shared']);
    releaseDocumentAssetOwnership(db, 'doc-a', ['shared']);
    expect(db.prepare('SELECT document_node_id, asset_id FROM document_asset_links ORDER BY document_node_id').all()).toEqual([
      { document_node_id: 'doc-a', asset_id: 'keep' }, { document_node_id: 'doc-b', asset_id: 'shared' },
    ]);
    expect(db.prepare('SELECT id FROM assets ORDER BY id').all()).toEqual([{ id: 'keep' }, { id: 'shared' }]);
  } finally { db.close(); }
});
