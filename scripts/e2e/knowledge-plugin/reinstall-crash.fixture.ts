import assert from 'node:assert/strict';
import fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { installPluginFromRemoteAndActivate } from '../../../src/features/plugins/install/orchestration/installPluginFromRemoteAndActivate';
import { resolvePluginRemovalMarkerPath } from '../../../src/features/plugins/install/functions/pluginRemovalMarker';
import { resolveDiskPluginUpgradePlan } from '../../../src/electron-main/plugins/install/diskPluginUpgradePlan';
import { resolvePluginCatalogSource } from '../../../src/features/plugins/catalog/functions/resolvePluginCatalogSource';
import { createCatalogPluginReleaseSource } from '../../../src/features/plugins/catalog/orchestration/createCatalogPluginReleaseSource';
import { createPluginCatalogStateStore } from '../../../src/features/plugins/catalog/infrastructure/pluginCatalogStateStore';
import { installRuntimeComponent, isRuntimeComponentCurrent } from '../../../src/features/runtimes/orchestration/installRuntimeComponent';
import { RENDERER_UI_VERSION } from '../../../packages/renderer-ui/src/version';

// 知识库只远程分发：与 Desktop 同一个远程安装入口，来源是验收进程启动的本机开发 catalog（环境变量继承自父进程）。
const [workspaceDb, userPluginRoot, runtimeRoot, evidencePath, checkpoint] = process.argv.slice(2);
assert.ok(workspaceDb && userPluginRoot && runtimeRoot && evidencePath && checkpoint);
const source = resolvePluginCatalogSource({ identity: { kind: 'source', packaged: false }, env: process.env });
assert.ok(source?.kind === 'development', '缺少本机开发 catalog 环境变量');
const probeRoot = dirname(evidencePath);
assert.match(basename(probeRoot), /^knowledge-reinstall-crash-\d+$/);
assert.equal(workspaceDb, join(probeRoot, 'workspace', 'workspace', 'workspace.sqlite'));
assert.equal(userPluginRoot, join(probeRoot, 'plugins'));
const appVersion: unknown = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
assert.ok(typeof appVersion === 'string');
const db = new Database(workspaceDb, { fileMustExist: true });
const pluginId = 'knowledge';

function crash(): never {
  fs.writeFileSync(evidencePath, JSON.stringify({
    checkpoint,
    inTransaction: db.inTransaction,
  }), { flag: 'wx' });
  process.kill(process.pid, 'SIGKILL');
  throw new Error(`Did not stop at ${checkpoint}`);
}

if (checkpoint === 'before-commit') {
  // activating 是安装事务的最后一笔业务写入；迁移结束但指针尚未提交。
  db.function('acceptance_checkpoint', crash);
  db.exec(`CREATE TEMP TRIGGER acceptance_before_install_commit AFTER INSERT ON main.plugin_active_versions
    WHEN NEW.plugin_id = 'knowledge' AND NEW.status = 'activating' BEGIN SELECT acceptance_checkpoint(); END;`);
} else if (checkpoint === 'after-stage') {
  // 版本目录已原子改名到位、安装回执尚未写入：重启后该目录不能被准入，重装要走 already-staged 补写回执。
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (dirname(String(to)) === join(userPluginRoot, pluginId) && !String(to).endsWith('active.json')) crash();
  };
} else if (checkpoint === 'before-pointer' || checkpoint === 'after-pointer') {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const pointer = to === join(userPluginRoot, pluginId, 'active.json');
    if (pointer && checkpoint === 'before-pointer') crash();
    rename(from, to);
    if (pointer && checkpoint === 'after-pointer') crash();
  };
} else if (checkpoint === 'before-removal-marker' || checkpoint === 'after-removal-marker') {
  const rm = fs.rmSync;
  const marker = resolvePluginRemovalMarkerPath(userPluginRoot, pluginId);
  fs.rmSync = (target, options) => {
    if (target === marker && checkpoint === 'before-removal-marker') crash();
    rm(target, options);
    if (target === marker && checkpoint === 'after-removal-marker') crash();
  };
}

const result = await installPluginFromRemoteAndActivate({
  db, userPluginRoot, pluginId, appVersion,
  rendererUiVersion: RENDERER_UI_VERSION,
  knownPlugins: [],
  allowCatalogListedPlugins: true,
  releaseSource: createCatalogPluginReleaseSource({
    catalogUrl: source.catalogUrl, channel: source.channel, trustedKeys: source.trustedKeys,
    stateStore: createPluginCatalogStateStore({ userPluginRoot }),
    platform: process.platform, architecture: process.arch, allowLoopbackHttp: true,
  }),
  installRuntimes: {
    async pending(runtimes) {
      const pending = [];
      for (const runtime of runtimes) {
        if (!(await isRuntimeComponentCurrent({ runtimeRoot, runtime, trustedKeys: source.trustedKeys }))) pending.push(runtime);
      }
      return pending;
    },
    async install(runtime, provenance, control) {
      await installRuntimeComponent({ runtimeRoot, runtime, provenance, trustedKeys: source.trustedKeys, fetch: globalThis.fetch, control });
    },
  },
  resolveUpgradePlan(input) {
    if (checkpoint === 'after-install-record') crash();
    const plan = resolveDiskPluginUpgradePlan(input);
    if (checkpoint !== 'during-migration') return plan;
    assert.ok(plan.migrations.length > 0);
    return { ...plan, migrations: plan.migrations.map(migration => ({
      ...migration,
      up(migrationDb) {
        migration.up(migrationDb);
        crash();
      },
    })) };
  },
});
db.close();
assert.fail(`Reinstall did not reach checkpoint: ${JSON.stringify(result)}`);
