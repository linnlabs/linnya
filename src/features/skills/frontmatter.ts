/**
 * @file src/features/skills/frontmatter.ts
 * @description SKILL.md 文件解析器（对齐 Agent Skills 规范）
 *
 * 中文备注：
 * - 从 SKILL.md 中提取 YAML frontmatter 和 markdown body；
 * - 严格校验 name 格式（正则、长度、目录名匹配）；
 * - 校验 description 长度（1-1024）；
 * - 支持 metadata 嵌套键值对；
 * - 对格式错误采用跳过 + 警告策略。
 */

import { parseDocument } from 'yaml';
import { z } from 'zod';
import type { SkillFrontmatter, ParsedSkillFile } from './types';

const FRONTMATTER_DELIMITER = '---';

/**
 * name 字段正则：小写字母/数字/连字符，不以连字符开头/结尾，无连续连字符
 * 规范：agentskills.io/specification#name-field
 */
const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const NAME_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 1024;
const COMPATIBILITY_MAX_LENGTH = 500;

/**
 * 从 SKILL.md 原始内容中解析 frontmatter 和 body
 *
 * @param raw SKILL.md 文件原始内容
 * @param filePath 文件绝对路径（用于日志）
 * @param directoryName 父目录名（用于 name-directory 匹配校验）
 * @returns 解析成功返回 ParsedSkillFile，失败返回 null
 */
export function parseSkillFile(
  raw: string,
  filePath: string,
  directoryName?: string,
): ParsedSkillFile | null {
  const trimmed = raw.trim();

  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    console.warn(`[Skill] ${filePath}: 缺少 frontmatter 开头分隔符，跳过`);
    return null;
  }

  const afterFirstDelimiter = FRONTMATTER_DELIMITER.length;
  const secondDelimiterIndex = trimmed.indexOf(`\n${FRONTMATTER_DELIMITER}`, afterFirstDelimiter);
  if (secondDelimiterIndex === -1) {
    console.warn(`[Skill] ${filePath}: 缺少 frontmatter 结尾分隔符，跳过`);
    return null;
  }

  const yamlContent = trimmed.slice(afterFirstDelimiter, secondDelimiterIndex).trim();
  const body = trimmed.slice(secondDelimiterIndex + 1 + FRONTMATTER_DELIMITER.length).trim();

  const parsed = parseFrontmatterYaml(yamlContent);
  if (!parsed) {
    console.warn(`[Skill] ${filePath}: frontmatter 解析失败，跳过`);
    return null;
  }

  // ── 提取并校验 name ──
  const name = typeof parsed['name'] === 'string' ? parsed['name'].trim() : '';

  if (!name) {
    console.warn(`[Skill] ${filePath}: name 为空，跳过（name 是规范必需字段）`);
    return null;
  }

  if (name.length > NAME_MAX_LENGTH) {
    console.warn(`[Skill] ${filePath}: name "${name}" 超过 ${NAME_MAX_LENGTH} 字符限制，跳过`);
    return null;
  }

  if (!NAME_REGEX.test(name)) {
    console.warn(
      `[Skill] ${filePath}: name "${name}" 格式不合规（要求：小写字母+数字+连字符，不以连字符开头/结尾，无连续连字符），跳过`
    );
    return null;
  }

  if (name.includes('--')) {
    console.warn(`[Skill] ${filePath}: name "${name}" 包含连续连字符（--），跳过`);
    return null;
  }

  // 规范要求 name 必须与父目录名匹配
  if (directoryName && name !== directoryName) {
    console.warn(
      `[Skill] ${filePath}: name "${name}" 与父目录名 "${directoryName}" 不匹配（规范要求一致），跳过`
    );
    return null;
  }

  // ── 提取并校验 description ──
  const description = typeof parsed['description'] === 'string' ? parsed['description'].trim() : '';

  if (!description) {
    console.warn(`[Skill] ${filePath}: description 为空，跳过（description 是规范必需字段）`);
    return null;
  }

  if (description.length > DESCRIPTION_MAX_LENGTH) {
    console.warn(
      `[Skill] ${filePath}: description 超过 ${DESCRIPTION_MAX_LENGTH} 字符限制（当前 ${description.length}），跳过`
    );
    return null;
  }

  // ── 提取可选字段 ──
  const license = typeof parsed['license'] === 'string' ? parsed['license'].trim() || undefined : undefined;

  const compatibility = typeof parsed['compatibility'] === 'string' ? parsed['compatibility'].trim() || undefined : undefined;
  if (compatibility && compatibility.length > COMPATIBILITY_MAX_LENGTH) {
    console.warn(`[Skill] ${filePath}: compatibility 超过 ${COMPATIBILITY_MAX_LENGTH} 字符限制，已忽略该字段`);
  }

  const allowedTools = typeof parsed['allowed-tools'] === 'string' ? parsed['allowed-tools'].trim() || undefined : undefined;

  // metadata 嵌套字段
  const metadata = parsed['metadata'];

  const disableModelInvocation = parsed['disable-model-invocation']?.trim().toLowerCase() === 'true';

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    ...(license ? { license } : {}),
    ...(compatibility && compatibility.length <= COMPATIBILITY_MAX_LENGTH ? { compatibility } : {}),
    ...(metadata ? { metadata } : {}),
    ...(allowedTools ? { 'allowed-tools': allowedTools } : {}),
    ...(disableModelInvocation ? { 'disable-model-invocation': true } : {}),
  };

  return { frontmatter, body };
}

// YAML 用 failsafe schema 解析：所有标量保持原文字符串（`version: 1.0` 不会变成数字 1），
// 块标量、引号与重复 key 仍由完整 YAML 解析器处理。可选字段格式不对时只忽略该字段，
// 不让整个 Skill 因为 metadata 或 allowed-tools 的写法而不可用。
const scalar = z.string();
const FrontmatterFields = z.object({
  name: scalar,
  description: scalar,
  license: scalar.optional().catch(undefined),
  compatibility: scalar.optional().catch(undefined),
  metadata: z.record(z.string(), scalar).optional().catch(undefined),
  'allowed-tools': z.union([scalar, z.array(scalar)])
    .transform(value => (Array.isArray(value) ? value.join(' ') : value))
    .optional().catch(undefined),
  'disable-model-invocation': scalar.optional().catch(undefined),
}).passthrough();

function parseFrontmatterYaml(content: string): z.infer<typeof FrontmatterFields> | null {
  const document = parseDocument(content, { uniqueKeys: true, schema: 'failsafe' });
  if (document.errors.length > 0) return null;
  try {
    const raw: unknown = document.toJS({ maxAliasCount: 50 });
    const parsed = FrontmatterFields.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch (error: unknown) {
    console.warn('[Skill] YAML 引用无法解析:', error instanceof Error ? error.message : 'invalid_yaml');
    return null;
  }
}
