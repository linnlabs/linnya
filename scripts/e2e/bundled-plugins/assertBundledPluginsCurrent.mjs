import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
// 与 Desktop 的 readPluginArtifactIdentity 同一口径：SHA512SUMS 去掉首尾空白后的全文。
const readIdentity = directory => {
  const file = join(directory, 'SHA512SUMS');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
};

/**
 * 升级后每个随包插件的实际状态：安装包里的版本与内容、用户插件目录里正在用的版本与内容、插件列表里的状态。
 * `listing` 是 `window.electronAPI.plugins.list()` 的 data。
 */
export function readBundledPluginsCurrentState({ bundledPluginRoot, userPluginRoot, listing }) {
  return readdirSync(bundledPluginRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(bundledPluginRoot, entry.name, 'plugin.json')))
    .map(entry => {
      const source = join(bundledPluginRoot, entry.name);
      const manifest = readJson(join(source, 'plugin.json'));
      const activeFile = join(userPluginRoot, manifest.id, 'active.json');
      const activeVersion = existsSync(activeFile) ? readJson(activeFile).version : null;
      const listed = listing.find(item => item.meta.id === manifest.id);
      return {
        id: manifest.id,
        bundledVersion: manifest.version,
        installOnDemand: existsSync(join(source, '.install-on-demand')),
        activeVersion,
        // 正在用的版本目录与安装包内容一致；没有启用版本时为 null。
        contentMatches: activeVersion === null ? null
          : readIdentity(join(userPluginRoot, manifest.id, activeVersion)) === readIdentity(source),
        listedState: listed?.state ?? null,
        listedVersion: listed?.meta.version ?? null,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * 老用户升级后，每个随包插件都必须换到安装包里的这一版：启用的版本等于安装包版本、版本目录内容与安装包一致、
 * 插件列表显示已启用且版本相同。同版本内容不同的冲突会让 Desktop 保留旧内容，只看“已启用”测不出来。
 * 按需安装且用户本来没装的插件不要求装上；`skip` 用于用户事先卸载过的插件。
 */
export function assertBundledPluginsCurrent(input, { skip = [] } = {}) {
  const rows = readBundledPluginsCurrentState(input);
  const problems = rows.filter(row => !skip.includes(row.id))
    .filter(row => !(row.installOnDemand && row.activeVersion === null))
    .flatMap(row => [
      row.activeVersion !== row.bundledVersion && `${row.id}: 启用的是 ${row.activeVersion ?? '（无）'}，安装包里是 ${row.bundledVersion}`,
      row.activeVersion === row.bundledVersion && !row.contentMatches && `${row.id}@${row.bundledVersion}: 版本目录内容与安装包不同（同版本号换了内容）`,
      row.listedState !== 'enabled' && `${row.id}: 插件列表状态是 ${row.listedState ?? '（不在列表里）'}`,
      row.listedVersion !== row.bundledVersion && `${row.id}: 插件列表显示 ${row.listedVersion ?? '（无）'}，安装包里是 ${row.bundledVersion}`,
    ].filter(Boolean));
  assert.deepEqual(problems, [], `升级后随包插件没有换到安装包里的版本：\n- ${problems.join('\n- ')}`);
  return rows;
}
