import Database from 'better-sqlite3';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { canvasPluginMigrations } from '../migrations';
import { createCanvasPlainTextDocument } from '../../../shared';
import { commitCanvasOperations, initializeCanvasDocument, readCanvasCommitState, readCanvasSnapshot } from '../../features/canvasCommit';

it('upgrades known current, guard, anchor and reverse revisions without rewriting damaged or future-format data', () => {
  const database = new Database(':memory:');
  try {
    database.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('doc'), ('future')");
    for (const migration of canvasPluginMigrations.filter(migration => migration.version < 5)) migration.up(database);
    database.exec("INSERT INTO canvas_documents(node_id) VALUES ('doc'); INSERT INTO canvas_documents(node_id,schema_version) VALUES ('future',2)");
    const current = '{"schemaVersion":1,"revision":7,"type":"unknown"}', broken = '{not-json';
    const insert = database.prepare("INSERT INTO canvas_elements(node_id,element_id,element_json,field_versions_json) VALUES (?, ?, ?, '{}')");
    insert.run('doc', 'c1', current); insert.run('doc', 'c2', broken); insert.run('future', 'c1', '{"schemaVersion":1,"revision":99999}');
    database.exec("INSERT INTO canvas_history_guards VALUES ('doc','c3','old-origin',12)");
    const anchor = gzipSync(JSON.stringify({ schemaVersion: 1, elements: [{ schemaVersion: 1, revision: 16 }] }));
    const inverse = gzipSync(JSON.stringify([{ kind: 'put', element: { schemaVersion: 1, revision: 19 } }, { kind: 'patch', fields: { revision: 23 } }]));
    const invalidBlob = Buffer.from('corrupted gzip');
    const insertVersion = database.prepare("INSERT INTO canvas_versions(node_id,version_id,sequence,created_at,schema_version,state_hash,reverse_blob,anchor_blob,asset_ids_json) VALUES ('doc', ?, ?, 0, ?, 'hash', ?, ?, '[]')");
    insertVersion.run('old', 1, 1, inverse, anchor); insertVersion.run('broken', 2, 1, invalidBlob, invalidBlob);
    insertVersion.run('future', 3, 2, gzipSync(JSON.stringify([{ kind: 'patch', fields: { revision: 5000 } }])), null);
    database.prepare("INSERT INTO canvas_version_heads(node_id,latest_version_id,head_sequence,changed_at,reverse_blob) VALUES ('doc','old',3,0,?)").run(gzipSync(JSON.stringify([{ kind: 'patch', fields: { revision: 29 } }])));
    const upgrade = canvasPluginMigrations.find(migration => migration.version === 5);
    if (!upgrade) throw new Error('Migration missing');
    expect(() => upgrade.up(database)).not.toThrow();
    expect(database.prepare('SELECT node_id,maximum_revision FROM canvas_documents ORDER BY node_id').all()).toEqual([{ node_id: 'doc', maximum_revision: 29 }, { node_id: 'future', maximum_revision: 0 }]);
    expect(database.prepare("SELECT element_json FROM canvas_elements WHERE node_id='doc' ORDER BY element_id").all()).toEqual([{ element_json: current }, { element_json: broken }]);
    expect(database.prepare("SELECT reverse_blob FROM canvas_versions WHERE version_id='broken'").get()).toEqual({ reverse_blob: invalidBlob });
    expect(readCanvasSnapshot(database, 'doc').integrity?.readOnly).toBe(true);
    expect(readCanvasSnapshot(database, 'future').integrity?.readOnly).toBe(true);
  } finally { database.close(); }
});

it('rolls revision facts back with content and never lowers the floor on later low-revision additions', () => {
  const database = new Database(':memory:');
  const actor = { viewId: 'view', source: { kind: 'user', conversationId: null, runId: null } } as const;
  const operations = [{ op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument('正文') }];
  try {
    database.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('doc')");
    for (const migration of canvasPluginMigrations) migration.up(database);
    initializeCanvasDocument(database, 'doc');
    expect(() => commitCanvasOperations({ database, actor, now: 1, request: { documentId: 'doc', requestId: 'failed', operations }, ports: { participants: [{ commit() { throw new Error('Owner rejected'); } }] } })).toThrow('Owner rejected');
    expect(readCanvasCommitState(database, 'doc')).toMatchObject({ maximumRevision: 0, elements: [] });
    commitCanvasOperations({ database, actor, now: 2, request: { documentId: 'doc', requestId: 'create', operations } });
    commitCanvasOperations({ database, actor, now: 3, request: { documentId: 'doc', requestId: 'edit', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'green' } }] } });
    commitCanvasOperations({ database, actor, now: 4, request: { documentId: 'doc', requestId: 'add-low', operations } });
    expect(readCanvasCommitState(database, 'doc').maximumRevision).toBe(2);
  } finally { database.close(); }
});
