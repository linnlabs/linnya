/**
 * @file src/features/skills/catalog.ts
 * @description Skill 统一查询入口（Tier 1 Catalog + Tier 2 Body + Tier 3 Resources）
 *
 * 中文备注：
 * - Tier 1：构建 catalog XML，注入模型上下文（name + description，~50-100 tokens/skill）；
 * - Tier 2：按需加载 SKILL.md 正文（activate 时触发）；
 * - Tier 3：按需列出/读取 Skill 目录下的资源文件。
 * - 所有文件系统操作、路径安全校验集中在此，工具层（SkillTool）不直接碰 fs。
 */

import fs from 'fs';
import path from 'path';
import type { SkillMetadata, SkillSource } from './types';
import { discoverSkills } from './discovery';
import { parseSkillFile } from './frontmatter';
import { filterAvailableSkills } from './availability';

// ─── 资源操作限制 ───

/** 单个资源文件大小上限（512KB） */
const MAX_RESOURCE_SIZE_BYTES = 512 * 1024;
/** 资源列表最大条目数 */
const MAX_RESOURCE_LIST = 50;
/** 目录递归最大深度 */
const MAX_RESOURCE_DEPTH = 3;

// ─── Tier 2/3 返回类型 ───

/** loadSkillContent 的返回结构 */
export interface SkillContent {
  name: string;
  source: SkillSource;
  body: string;
  resources: string[];
}

// ─── Tier 1：Catalog（元数据发现与 XML 构建） ───

/**
 * 构建 Skill Catalog XML（用于 system prompt 的当前能力目录）
 *
 * 中文备注：
 * - 只包含允许模型自动触发的 Skill（过滤掉 disable-model-invocation: true 的）；
 * - catalog 只承载 name + description；使用规则由 skill 工具描述和 agent 固定规则负责。
 *
 * @returns XML 字符串，无可用 Skill 时返回空字符串
 */
export function buildSkillCatalogXml(): string {
  const allSkills = filterAvailableSkills(discoverSkills());

  const visibleSkills = allSkills.filter(s => !s.disableModelInvocation);

  if (visibleSkills.length === 0) {
    return '';
  }

  const skillEntries = visibleSkills
    .map(s => `  <skill name="${escapeXmlAttr(s.name)}">${escapeXmlText(s.description)}</skill>`)
    .join('\n');

  return [
    '<available_skills>',
    skillEntries,
    '</available_skills>',
  ].join('\n');
}

/**
 * 获取所有已发现的 Skill 元数据（含禁止自动触发的）
 */
export function getAllSkillMetadata(): SkillMetadata[] {
  return discoverSkills();
}

/**
 * 按名称查找 Skill 元数据
 */
export function getSkillByName(name: string): SkillMetadata | undefined {
  return filterAvailableSkills(discoverSkills()).find(s => s.name === name);
}

// ─── Tier 2：加载 Skill 正文（activate） ───

/**
 * 加载 Skill 正文与资源列表
 *
 * 中文备注：
 * - activate 时调用，读取 SKILL.md body（Tier 2）并附带资源文件索引（Tier 3）；
 * - discovery 阶段已做过 frontmatter 严格校验，这里只需提取 body；
 * - 找不到 Skill 时直接 throw，由调用方决定如何呈现错误。
 */
export function loadSkillContent(name: string): SkillContent {
  const skill = requireSkill(name);

  let raw: string;
  try {
    raw = fs.readFileSync(skill.location, 'utf-8');
  } catch (e) {
    throw new Error(`无法读取 Skill 文件 ${skill.location}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const parsed = parseSkillFile(raw, skill.location);
  if (!parsed) {
    throw new Error(`Skill 文件解析失败: ${skill.location}`);
  }

  const resources = scanResourceFiles(skill.directory);

  return {
    name: skill.name,
    source: skill.source,
    body: parsed.body,
    resources,
  };
}

// ─── Tier 3：资源文件操作 ───

/**
 * 列出 Skill 目录下的资源文件（排除 SKILL.md 和隐藏文件）
 */
export function listSkillResources(name: string): string[] {
  const skill = requireSkill(name);
  return scanResourceFiles(skill.directory);
}

/**
 * 读取 Skill 目录下的指定资源文件
 *
 * 中文备注：
 * - 路径安全校验：resolve 后必须在 Skill 目录内（防止目录逃逸）；
 * - 大小限制：超过 MAX_RESOURCE_SIZE_BYTES 时直接 throw。
 */
export function readSkillResource(name: string, resourcePath: string): string {
  const skill = requireSkill(name);

  const baseDir = path.resolve(skill.directory);
  const resolved = path.resolve(baseDir, resourcePath);
  // 不能用 startsWith(baseDir) 直接判定，否则 /a/b2 会被 /a/b 误判为同前缀
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw new Error(`资源路径不合法（不允许访问 Skill 目录外的文件）: ${resourcePath}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`资源文件不存在: ${resourcePath}（skill="${name}"）`);
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_RESOURCE_SIZE_BYTES) {
    throw new Error(
      `资源文件过大（${stat.size} bytes，限制 ${MAX_RESOURCE_SIZE_BYTES} bytes）: ${resourcePath}（skill="${name}"）`
    );
  }

  return fs.readFileSync(resolved, 'utf-8');
}

// ─── 内部辅助 ───

/**
 * 查找 Skill，不存在时 throw（消除调用方重复的查找 + 报错逻辑）
 */
function requireSkill(name: string): SkillMetadata {
  const skill = getSkillByName(name);
  if (!skill) {
    const available = filterAvailableSkills(discoverSkills()).map(s => s.name);
    throw new Error(
      available.length > 0
        ? `找不到 Skill "${name}"。可用：${available.join(', ')}`
        : `找不到 Skill "${name}"。当前未发现任何可用 Skill（请检查内置 Skill 路径）`
    );
  }
  return skill;
}

/**
 * 扫描 Skill 目录下的资源文件
 *
 * 中文备注：
 * - 排除 SKILL.md（入口文件）和隐藏文件/目录（以 . 开头）；
 * - 最大递归深度 MAX_RESOURCE_DEPTH，最大条目数 MAX_RESOURCE_LIST；
 * - 路径统一使用 / 分隔（跨平台一致性）。
 */
function scanResourceFiles(dir: string): string[] {
  const results: string[] = [];
  walkResourceDir(dir, dir, results);
  return results.slice(0, MAX_RESOURCE_LIST);
}

function walkResourceDir(baseDir: string, currentDir: string, results: string[], depth = 0): void {
  if (depth > MAX_RESOURCE_DEPTH || results.length >= MAX_RESOURCE_LIST) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESOURCE_LIST) break;
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      walkResourceDir(baseDir, fullPath, results, depth + 1);
    } else if (entry.name !== 'SKILL.md') {
      results.push(relativePath);
    }
  }
}

function escapeXmlAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlText(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
