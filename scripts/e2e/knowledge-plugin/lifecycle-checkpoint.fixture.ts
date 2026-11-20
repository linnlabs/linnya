import assert from 'node:assert/strict';
import fs from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { parsePluginManifest } from '@app/schemas';
import { uninstallPluginLifecycle } from '../../../src/features/plugins/install/orchestration/uninstallPluginLifecycle';
import { cleanupPluginData } from '../../../src/features/plugins/infrastructure/cleanup/pluginDataCleanup';
import { resolvePluginRemovalMarkerPath } from '../../../src/features/plugins/install/functions/pluginRemovalMarker';

const [checkpoint, root, manifestPath, workspaceDb] = process.argv.slice(2);
assert.ok(checkpoint && root && manifestPath && workspaceDb);
assert.match(basename(root), /^knowledge-lifecycle-\d+$/);
const userPluginRoot = join(root, 'plugins');
const dataRoot = join(root, 'workspace', 'Plugins', 'knowledge');
assert.equal(workspaceDb, join(root, 'workspace', 'workspace', 'workspace.sqlite'));
const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
const pluginId = 'knowledge';
assert.equal(manifest.id, pluginId);
const db = new Database(workspaceDb, { fileMustExist: true });
const evidencePath = join(root, 'lifecycle-checkpoint.json');

function crashAt(step: string): never {
  // 标记只用于证明实际经过断点。SIGKILL 后观察真实 SQLite 和目录，不把这个文件当产品状态。
  fs.writeFileSync(evidencePath, JSON.stringify({ step, inTransaction: db.inTransaction }), {
    flag: 'wx',
  });
  process.kill(process.pid, 'SIGKILL');
  throw new Error(`Process did not stop at ${step}`);
}

if (checkpoint === 'uninstall-before-intent') {
  db.function('acceptance_checkpoint', () => crashAt(checkpoint));
  db.exec(`CREATE TEMP TRIGGER acceptance_before_uninstall BEFORE UPDATE OF user_removed ON main.installed_plugins
    WHEN NEW.plugin_id = 'knowledge' AND NEW.user_removed = 1 BEGIN SELECT acceptance_checkpoint(); END;`);
} else if (checkpoint === 'uninstall-before-marker') {
  const originalWrite = fs.writeFileSync;
  const marker = resolvePluginRemovalMarkerPath(userPluginRoot, pluginId);
  fs.writeFileSync = (target, value, options) => {
    if (target === marker) crashAt(checkpoint);
    originalWrite(target, value, options);
  };
} else if (checkpoint === 'cleanup-before-commit') {
  db.function('acceptance_checkpoint', () => crashAt(checkpoint));
  // 清理记录 DELETE 是最终事务内最后一条写入，前面的 DROP、迁移删除和归零仍未提交。
  db.exec(`CREATE TEMP TRIGGER acceptance_before_cleanup_commit AFTER DELETE ON main.plugin_cleanup_jobs
    WHEN OLD.plugin_id = 'knowledge' BEGIN SELECT acceptance_checkpoint(); END;`);
}

if (checkpoint.startsWith('uninstall-')) {
  const result = uninstallPluginLifecycle({ db, userPluginRoot, pluginId, knownPlugins: [] });
  assert.fail(`Did not hit uninstall checkpoint: ${JSON.stringify(result)}`);
}

assert.ok(checkpoint === 'cleanup-before-commit' || checkpoint === 'cleanup-after-commit');
const result = await cleanupPluginData({
  db,
  pluginId,
  dataRoot,
  dataStorage: manifest.dataStorage,
  ownedTables: manifest.ownedTables,
});
assert.equal(result.status, 'completed', JSON.stringify(result));
if (checkpoint === 'cleanup-after-commit') crashAt(checkpoint);
assert.fail('Did not hit the final cleanup transaction checkpoint');
