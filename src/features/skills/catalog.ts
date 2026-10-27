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

import { listSkillFiles, readSkillText, readSkillTextLossy } from './shared/skillFiles';
import type { SkillMetadata, SkillSource } from './types';
import { discoverSkills } from './discovery';
import { parseSkillFile } from './frontmatter';
import { filterAvailableSkills } from './availability';
import { SKILL_AUTHORING_SKILL } from './functions/canAuthorSkills';

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
export function buildSkillCatalogXml(includeAuthoring = false): string {
  const allSkills = filterAvailableSkills(discoverSkills());

  const visibleSkills = allSkills.filter(s => !s.disableModelInvocation && (includeAuthoring || s.name !== SKILL_AUTHORING_SKILL));

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

  const raw = readSkillText(skill.directory, 'SKILL.md');
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

  if (!scanResourceFiles(skill.directory).includes(resourcePath)) {
    throw new Error('资源不在 Skill 支持文件清单中');
  }
  return readSkillText(skill.directory, resourcePath);
}

/**
 * 供运行兼容性摘要使用：与 readSkillResource 共用清单与大小准入，但不因非法 UTF-8 抛错。
 * 合法文本得到与 readSkillResource 完全相同的字符串，已有摘要不变。
 */
export function readSkillResourceForDigest(name: string, resourcePath: string): string {
  const skill = requireSkill(name);
  if (!scanResourceFiles(skill.directory).includes(resourcePath)) {
    throw new Error('资源不在 Skill 支持文件清单中');
  }
  return readSkillTextLossy(skill.directory, resourcePath);
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
  return listSkillFiles(dir).filter(file => file !== 'SKILL.md');
}

function escapeXmlAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlText(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
