import assert from 'node:assert/strict';
import fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { installPluginFromRemoteAndActivate } from '../../../src/features/plugins/install/orchestration/installPluginFromRemoteAndActivate';
import { resolveDiskPluginUpgradePlan } from '../../../src/electron-main/plugins/install/diskPluginUpgradePlan';
import { resolvePluginCatalogSource } from '../../../src/features/plugins/catalog/functions/resolvePluginCatalogSource';
import { createCatalogPluginReleaseSource } from '../../../src/features/plugins/catalog/orchestration/createCatalogPluginReleaseSource';
import { createPluginCatalogStateStore } from '../../../src/features/plugins/catalog/infrastructure/pluginCatalogStateStore';
import { installRuntimeComponent, isRuntimeComponentCurrent } from '../../../src/features/runtimes/orchestration/installRuntimeComponent';
import { RENDERER_UI_VERSION } from '../../../packages/renderer-ui/src/version';

// 已安装旧版、开发 catalog 已发布更高版本：与商店“更新”同一个远程安装入口，在升级的实际写入点强杀。
const [workspaceDb, userPluginRoot, runtimeRoot, evidencePath, checkpoint] = process.argv.slice(2);
assert.ok(workspaceDb && userPluginRoot && runtimeRoot && evidencePath && checkpoint);
const source = resolvePluginCatalogSource({ identity: { kind: 'source', packaged: false }, env: process.env });
assert.ok(source?.kind === 'development', '缺少本机开发 catalog 环境变量');
const probeRoot = dirname(evidencePath);
assert.match(basename(probeRoot), /^knowledge-upgrade-checkpoint-\d+$/);
assert.equal(workspaceDb, join(probeRoot, 'workspace', 'workspace', 'workspace.sqlite'));
assert.equal(userPluginRoot, join(probeRoot, 'plugins'));
const appVersion: unknown = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
assert.ok(typeof appVersion === 'string');
const db = new Database(workspaceDb, { fileMustExist: true });
const pluginId = 'knowledge';

function crash(): never {
  fs.writeFileSync(evidencePath, JSON.stringify({ checkpoint, inTransaction: db.inTransaction }), { flag: 'wx' });
  process.kill(process.pid, 'SIGKILL');
  throw new Error(`Did not stop at ${checkpoint}`);
}

if (checkpoint === 'before-commit') {
  // 升级把迁移与 activating 账本放在同一事务：迁移已跑完、事务尚未提交。
  db.function('acceptance_upgrade_checkpoint', crash);
  db.exec(`CREATE TEMP TRIGGER acceptance_upgrade_before_commit AFTER UPDATE OF status ON main.plugin_active_versions
    WHEN NEW.plugin_id = 'knowledge' AND NEW.status = 'activating' BEGIN SELECT acceptance_upgrade_checkpoint(); END;`);
} else if (checkpoint === 'before-pointer' || checkpoint === 'after-pointer') {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const pointer = to === join(userPluginRoot, pluginId, 'active.json');
    if (pointer && checkpoint === 'before-pointer') crash();
    rename(from, to);
    if (pointer && checkpoint === 'after-pointer') crash();
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
    const plan = resolveDiskPluginUpgradePlan(input);
    if (checkpoint !== 'during-migration') return plan;
    // 计划含全部迁移，已提交的由执行器跳过（是否重放由验收比对 applied_at 证明）；在新版本那条迁移执行后强杀。
    const newest = Math.max(...plan.migrations.map(migration => migration.version));
    return { ...plan, migrations: plan.migrations.map(migration => ({
      ...migration,
      up(migrationDb) {
        migration.up(migrationDb);
        if (migration.version === newest) crash();
      },
    })) };
  },
});
db.close();
assert.fail(`Upgrade did not reach ${checkpoint}: ${JSON.stringify(result)}`);
