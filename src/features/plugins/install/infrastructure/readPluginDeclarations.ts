import fs from 'node:fs';
import path from 'node:path';

import { parsePluginManifest, type PluginId } from '@app/schemas';

/**
 * 安装包内远程分发插件的声明目录：`<root>/<pluginId>/plugin.json`，按需安装的另有 `.install-on-demand`。
 * 只返回目录名与 manifest id 一致、声明可解析的按需插件；读取失败的条目跳过，不影响其他插件。
 */
export function listOnDemandPluginDeclarations(declarationRoot: string | undefined): PluginId[] {
  if (!declarationRoot || !fs.existsSync(declarationRoot)) return [];
  return fs.readdirSync(declarationRoot, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    const directory = path.join(declarationRoot, entry.name);
    if (!fs.existsSync(path.join(directory, '.install-on-demand'))) return [];
    try {
      const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8')) as unknown);
      return manifest.id === entry.name ? [manifest.id] : [];
    } catch {
      return [];
    }
  });
}
