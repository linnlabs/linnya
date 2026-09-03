import fs from 'node:fs';
import path from 'node:path';

const SLIDES_PACKAGE_NAME = '@plugin/slides';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPackageName(directory: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(directory, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}

/**
 * Slides 自带 Skill 资源根目录候选。
 *
 * 中文说明：
 * - 磁盘插件安装态会由 host 根据插件安装目录追加精确的 `resources/skills` 根；
 * - 这里主要服务源码态 inline 插件，让开发时移走 host builtin skill 后仍能发现
 *   `slides-design`；
 * - 候选路径不在这里做存在性过滤，避免把“当前 cwd 是什么”变成插件业务规则。
 */
export function resolveSlidesSkillResourceRoots(): readonly string[] {
  if (
    process.env.LINNYA_PLUGIN_BACKEND_LOADING === 'disk' ||
    process.env.LINNYA_PLUGIN_BACKEND_LOADING === 'disk-only'
  ) {
    return [];
  }

  const cwd = process.cwd();
  const roots = [
    path.resolve(cwd, 'packages/plugins/slides/resources/skills'),
  ];

  if (readPackageName(cwd) === SLIDES_PACKAGE_NAME) {
    roots.push(path.resolve(cwd, 'resources/skills'));
  }

  return [
    ...new Set(roots),
  ];
}
