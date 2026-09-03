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

  const parsed = parseYamlWithNesting(yamlContent);
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
  const rawMetadata = parsed['metadata'];
  let metadata: Record<string, string> | undefined;
  if (rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)) {
    metadata = {};
    for (const [k, v] of Object.entries(rawMetadata as Record<string, unknown>)) {
      metadata[k] = String(v);
    }
  }

  const disableModelInvocation =
    parsed['disable-model-invocation'] === 'true' ||
    parsed['disable-model-invocation'] === true;

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

// ─── YAML 解析器 ───

type YamlValue = string | boolean | Record<string, string | boolean>;

/**
 * 支持一层嵌套的轻量 YAML 解析器
 *
 * 中文备注：
 * - 顶层：key: value（字符串/布尔）
 * - 嵌套：key:\n  sub-key: value（用于 metadata 字段）
 * - 不支持数组、多层嵌套等复杂结构（Skill frontmatter 不需要）
 */
function parseYamlWithNesting(content: string): Record<string, YamlValue> | null {
  const result: Record<string, YamlValue> = {};
  const lines = content.split('\n');
  let currentMapKey: string | null = null;
  let currentMap: Record<string, string | boolean> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    // 检测是否是缩进行（属于嵌套 map）
    const isIndented = line.startsWith('  ') || line.startsWith('\t');

    if (isIndented && currentMapKey) {
      // 解析嵌套 key-value
      const colonIdx = trimmedLine.indexOf(':');
      if (colonIdx === -1) continue;
      const subKey = trimmedLine.slice(0, colonIdx).trim();
      const subValue = stripQuotes(trimmedLine.slice(colonIdx + 1).trim());
      if (subKey) {
        currentMap[subKey] = toBooleanOrString(subValue);
      }
      continue;
    }

    // 非缩进行：如果之前有 map 在构建，先保存
    if (currentMapKey) {
      if (Object.keys(currentMap).length > 0) {
        result[currentMapKey] = currentMap;
      }
      currentMapKey = null;
      currentMap = {};
    }

    // 顶层 key: value
    const colonIdx = trimmedLine.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmedLine.slice(0, colonIdx).trim();
    const rawValue = trimmedLine.slice(colonIdx + 1).trim();

    if (!key) continue;

    if (rawValue === '' || rawValue === undefined) {
      // 值为空，可能是嵌套 map 的开始（如 metadata:）
      currentMapKey = key;
      currentMap = {};
    } else {
      result[key] = toBooleanOrString(stripQuotes(rawValue));
    }
  }

  // 循环结束后保存最后一个 map
  if (currentMapKey && Object.keys(currentMap).length > 0) {
    result[currentMapKey] = currentMap;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function toBooleanOrString(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
