/**
 * @file pluginSkillSources.ts
 * @description 插件 Skill 资源根目录注册表。
 *
 * 中文说明：
 * - Skill feature 只保存“哪些插件 skill 根目录当前可见”的只读快照；
 * - 插件安装、启停、升级仍由 plugin registry 负责，避免 Skill 系统反向管理插件运行态；
 * - discovery 读取这里的快照后，继续用同一套 SKILL.md 扫描和路径安全逻辑处理资源。
 */

import path from 'node:path';

export interface PluginSkillSourceRoot {
  readonly pluginId: string;
  /** 指向包含多个 `<skill-name>/SKILL.md` 子目录的根目录。 */
  readonly root: string;
}

let pluginSkillSourceRoots: readonly PluginSkillSourceRoot[] = [];

function normalizeSourceRoot(source: PluginSkillSourceRoot): PluginSkillSourceRoot | null {
  const pluginId = source.pluginId.trim();
  const root = source.root.trim();
  if (!pluginId || !root) return null;
  return {
    pluginId,
    root: path.resolve(root),
  };
}

export function replacePluginSkillSourceRoots(sources: readonly PluginSkillSourceRoot[]): void {
  const seen = new Set<string>();
  const next: PluginSkillSourceRoot[] = [];

  for (const source of sources) {
    const normalized = normalizeSourceRoot(source);
    if (!normalized) continue;
    const key = `${normalized.pluginId}\0${normalized.root}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }

  pluginSkillSourceRoots = next;
}

export function listPluginSkillSourceRoots(): readonly PluginSkillSourceRoot[] {
  return pluginSkillSourceRoots;
}

export function clearPluginSkillSourceRootsForTests(): void {
  pluginSkillSourceRoots = [];
}
