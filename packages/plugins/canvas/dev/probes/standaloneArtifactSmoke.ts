import { app } from 'electron';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CORE_SCHEMAS } from '../../../../../src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { installPluginCliHostModuleResolver } from '../../../../../src/domains/commands/features/host-module-resolution/infrastructure/installPluginCliHostModuleResolver';
import { canvasPluginMigrations } from '../../src/backend/persistence/migrations';

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
    } finally { db.close(); }
    app.exit(0); return;
  }
  const entry = path.join(artifactRoot, 'dist/cli/canvas-cli.cjs');
  installPluginCliHostModuleResolver({ pluginCliDirectory: path.dirname(entry), hostAppRoot: process.cwd() });
  const argv = ['--database', file, '--project', 'artifact-project', mode, 'workspace:/只读制品.canvas',
    ...(mode === 'apply' ? ['--ops-file', 'denied.json', '--request-id', 'forbidden'] : [])];
  process.argv = [process.execPath, entry, ...argv];
  createRequire(entry)(entry);
}
void run().catch(error => { console.error(error); app.exit(1); });
