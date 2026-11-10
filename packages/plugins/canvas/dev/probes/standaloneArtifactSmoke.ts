import { app } from 'electron';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CORE_SCHEMAS } from '../../../../../src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { installPluginCliHostModuleResolver } from '../../../../../src/domains/commands/features/host-module-resolution/infrastructure/installPluginCliHostModuleResolver';
import { canvasPluginMigrations } from '../../src/backend/persistence/migrations';
import { createCanvasHistoryRuntime } from '../../src/backend/orchestration/history/createCanvasHistoryRuntime';
import { createCanvasPlainTextDocument } from '../../src/shared';

async function run() {
  const [artifactRoot, file, mode] = process.argv.slice(2);
  if (!artifactRoot || !file || !mode) throw new Error('Artifact root, temporary database and mode required');
  app.setPath('userData', file + '-profile'); if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  await app.whenReady();
  if (mode === 'fixture') {
    const db = new Database(file);
    try {
      for (const sql of CORE_SCHEMAS) db.exec(sql);
      for (const migration of canvasPluginMigrations) migration.up(db);
      db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('artifact-project', 'Artifact fixture', 0, 0);
      db.prepare('INSERT INTO workspace_nodes(id,project_id,type,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('artifact-canvas', 'artifact-project', 'canvas', '只读制品.canvas', 0, 0);
      db.prepare('INSERT INTO canvas_documents(node_id) VALUES(?)').run('artifact-canvas');
      const history = createCanvasHistoryRuntime({ database: db });
      const result = history.commitAgent({ request: { documentId: 'artifact-canvas', requestId: 'artifact-write', operations: [
        { op: 'addText', content: createCanvasPlainTextDocument('原始回执正文'), width: 240, height: 120 },
        { op: 'update', id: 'c404', baseRevision: 1, patch: { color: 'yellow' } },
      ] }, actor: { viewId: 'artifact-agent', source: { kind: 'agent', conversationId: 'artifact-chat', runId: 'artifact-run' } }, now: 1 });
      if (result.kind !== 'committed') throw new Error('artifact_fixture_commit_required');
      // 当前内容继续变化，独立查询仍必须返回第一次提交的事实，而非重建当前快照。
      history.commit({ request: { documentId: 'artifact-canvas', requestId: 'later-user', operations: [
        { op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red' } },
      ] }, actor: { viewId: 'artifact-user', source: { kind: 'user', conversationId: null, runId: null } }, now: 2 });
      process.stdout.write(JSON.stringify({ ...result.commit, documentId: 'workspace:/只读制品.canvas' }) + '\n');
    } finally { db.close(); }
    app.exit(0); return;
  }
  const entry = path.join(artifactRoot, 'dist/cli/canvas-cli.cjs');
  installPluginCliHostModuleResolver({ pluginCliDirectory: path.dirname(entry), hostAppRoot: process.cwd() });
  const receipt = mode.startsWith('receipt');
  const argv = ['--database', file, '--project', mode === 'receipt-other-project' ? 'other-project' : 'artifact-project',
    ...(receipt ? ['--conversation', mode === 'receipt-other-conversation' ? 'other-chat' : 'artifact-chat'] : []),
    receipt ? 'receipt' : mode, 'workspace:/只读制品.canvas',
    ...(receipt ? [mode === 'receipt-missing' ? 'unknown-write' : 'artifact-write'] : []),
    ...(mode === 'apply' ? ['--ops-file', 'denied.json', '--request-id', 'forbidden'] : [])];
  process.argv = [process.execPath, entry, ...argv];
  createRequire(entry)(entry);
}
void run().catch(error => { console.error(error); app.exit(1); });
