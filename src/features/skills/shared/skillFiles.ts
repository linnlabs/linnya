import fs from 'node:fs';
import path from 'node:path';

export const SKILL_FILE_LIMIT = 512 * 1024;
export const SKILL_RESOURCE_LIMIT = 50;
export const SKILL_DEPTH_LIMIT = 3;

/** 读取与管理使用同一文件准入；手工放入的链接也不能越出 Skill 根。 */
export function resolveSkillFile(root: string, relativePath: string): string {
  const segments = relativePath.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || part.startsWith('.')
    || /[\\:\u0000-\u001f]/u.test(part)) || path.isAbsolute(relativePath)
    || segments.length > SKILL_DEPTH_LIMIT + 1) {
    throw new Error('Skill 文件必须使用目录内的普通相对路径');
  }
  const base = path.resolve(root);
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error('Skill 目录不能是符号链接');
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      // lstat 仍须识别断链；不存在的普通路径留给新文件写入。
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Skill 不支持符号链接');
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      continue;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error('Skill 只支持普通文件和目录');
    }
  }
  return current;
}

export function readSkillText(root: string, relativePath: string, maxBytes = SKILL_FILE_LIMIT): string {
  const target = resolveSkillFile(root, relativePath);
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) throw new Error('Skill 资源不是普通文件');
  if (stat.size > maxBytes) throw new Error(`资源文件过大（限制 ${maxBytes} bytes）: ${relativePath}`);
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(target));
}

export function listSkillFiles(root: string): string[] {
  const result: string[] = [];
  function visit(directory: string, prefix = '', depth = 0): void {
    if (depth > SKILL_DEPTH_LIMIT) throw new Error('Skill 资源目录超过 3 层');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = resolveSkillFile(root, relative);
      if (entry.isDirectory()) visit(target, relative, depth + 1);
      else if (entry.isFile()) {
        result.push(relative);
        if (result.length > SKILL_RESOURCE_LIMIT + 1) throw new Error('Skill 最多包含 50 个支持文件');
      } else throw new Error('Skill 不支持符号链接或特殊文件');
    }
  }
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('Skill 根必须是普通目录');
  }
  visit(root);
  return result;
}
