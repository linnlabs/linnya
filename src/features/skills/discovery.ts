/**
 * @file src/features/skills/discovery.ts
 * @description Skill 发现服务（合并内置 + 插件 + 用户三种来源）
 *
 * 中文备注：
 * - 内置、插件、用户 Skill 都是标准 SKILL.md 文件，扫描逻辑完全统一；
 * - 插件 Skill 也是标准 SKILL.md 文件，只是根目录由插件运行态同步；
 * - 内置 Skill 优先级最高，插件 Skill 次之，用户 Skill 仅补充，同名低优先级 Skill 被忽略；
 * - 生产结果缓存在内存中，TTL 5 分钟；开发模式不缓存，确保改 SKILL.md 立即生效。
 */

import fs from 'fs';
import path from 'path';
import { getSkillsPath } from '../../shared/utils/pathManager';
import { getBuiltinSkillsRoot } from './builtin';
import { parseSkillFile } from './frontmatter';
import { listPluginSkillSourceRoots } from './pluginSkillSources';
import type { SkillMetadata, SkillSource } from './types';

const MAX_SKILL_COUNT = 100;
const SKILL_ENTRY_FILE = 'SKILL.md';

let cachedMetadata: SkillMetadata[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function getSkillDiscoveryCacheTtlMs(): number {
  // 中文说明：开发插件/skill 时，最常见动作就是直接改 SKILL.md 后立刻试默认 agent。
  // 这里不使用 5 分钟缓存，避免开发者误判“插件 skill 注册没有生效”。
  if (process.env.LINNYA_DEV_MODE === 'true') return 0;
  return CACHE_TTL_MS;
}

/**
 * 发现所有可用 Skill（内置 + 插件 + 用户），返回合并后的元数据列表
 */
export function discoverSkills(): SkillMetadata[] {
  const now = Date.now();
  const cacheTtlMs = getSkillDiscoveryCacheTtlMs();
  if (cacheTtlMs > 0 && cachedMetadata !== null && (now - cacheTimestamp) < cacheTtlMs) {
    return cachedMetadata;
  }

  const result = mergeSkills();

  cachedMetadata = result;
  cacheTimestamp = now;

  if (result.length > 0) {
    const builtinCount = result.filter(s => s.source === 'builtin').length;
    const pluginCount = result.filter(s => s.source === 'plugin').length;
    const userCount = result.filter(s => s.source === 'user').length;
    console.log(
      `[Skill] 发现 ${result.length} 个 Skill（内置 ${builtinCount} + 插件 ${pluginCount} + 用户 ${userCount}）: ` +
      result.map(s => `${s.name}[${s.source}]`).join(', ')
    );
  }

  return result;
}

/**
 * 强制刷新缓存
 */
export function invalidateSkillCache(): void {
  cachedMetadata = null;
  cacheTimestamp = 0;
}

/**
 * 合并内置、插件和用户 Skill
 *
 * 中文备注：
 * - 先扫描内置 Skill（优先级最高），再扫描已启用插件 Skill，最后扫描用户 Skill（补充）；
 * - 用同样的扫描逻辑，仅 source 标记不同；
 * - 同名时高优先级 Skill 保留，低优先级 Skill 被忽略。
 */
function mergeSkills(): SkillMetadata[] {
  const merged = new Map<string, SkillMetadata>();

  // 1. 扫描内置 Skill（不可覆盖）
  const builtinRoot = getBuiltinSkillsRoot();
  const builtinSkills = scanDirectory(builtinRoot, 'builtin');
  for (const skill of builtinSkills) {
    merged.set(skill.name, skill);
  }

  // 2. 扫描插件 Skill（随 enabled 插件运行态同步，同名不覆盖内置）
  for (const sourceRoot of listPluginSkillSourceRoots()) {
    const pluginSkills = scanDirectory(sourceRoot.root, 'plugin', sourceRoot.pluginId);
    for (const skill of pluginSkills) {
      if (merged.has(skill.name)) {
        console.warn(`[Skill] 插件 Skill "${skill.name}" 与更高优先级 Skill 同名，已忽略（pluginId=${sourceRoot.pluginId}）`);
        continue;
      }
      merged.set(skill.name, skill);
    }
  }

  // 3. 扫描用户 Skill（补充性质，同名则忽略）
  const userRoot = getSkillsPath();
  const userSkills = scanDirectory(userRoot, 'user');
  for (const skill of userSkills) {
    if (merged.has(skill.name)) {
      console.warn(`[Skill] 用户 Skill "${skill.name}" 与内置 Skill 同名，已忽略（内置 Skill 不可覆盖）`);
      continue;
    }
    merged.set(skill.name, skill);
  }

  return Array.from(merged.values());
}

/**
 * 扫描指定目录下的 Skill 子目录（通用逻辑，内置和用户共用）
 */
function scanDirectory(root: string, source: SkillSource, pluginId?: string): SkillMetadata[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    console.warn(`[Skill] 读取 Skill 目录失败: ${root}`, e);
    return [];
  }

  const results: SkillMetadata[] = [];

  for (const entry of entries) {
    if (results.length >= MAX_SKILL_COUNT) {
      console.warn(`[Skill] 已达扫描上限 (${MAX_SKILL_COUNT})，停止扫描`);
      break;
    }

    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const skillDir = path.join(root, entry.name);
    const skillFilePath = path.join(skillDir, SKILL_ENTRY_FILE);

    if (!fs.existsSync(skillFilePath)) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(skillFilePath, 'utf-8');
    } catch (e) {
      console.warn(`[Skill] 读取 ${skillFilePath} 失败，跳过`, e);
      continue;
    }

    // 传入目录名用于 name-directory 匹配校验（规范要求 name 必须与父目录名一致）
    const parsed = parseSkillFile(raw, skillFilePath, entry.name);
    if (!parsed) continue;

    const skillName = parsed.frontmatter.name;

    const metadata = {
      ...(parsed.frontmatter.metadata ?? {}),
      ...(source === 'plugin' && pluginId ? { pluginId } : {}),
    };

    results.push({
      name: skillName,
      description: parsed.frontmatter.description,
      source,
      location: skillFilePath,
      directory: skillDir,
      disableModelInvocation: parsed.frontmatter['disable-model-invocation'] === true,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }

  return results;
}
