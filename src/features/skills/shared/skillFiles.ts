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

function readSkillBytes(root: string, relativePath: string, maxBytes: number): Buffer {
  const target = resolveSkillFile(root, relativePath);
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) throw new Error('Skill 资源不是普通文件');
  if (stat.size > maxBytes) throw new Error(`资源文件过大（限制 ${maxBytes} bytes）: ${relativePath}`);
  return fs.readFileSync(target);
}

export function readSkillText(root: string, relativePath: string, maxBytes = SKILL_FILE_LIMIT): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(readSkillBytes(root, relativePath, maxBytes));
}

/**
 * 只供运行兼容性摘要使用：合法 UTF-8 与 readSkillText 逐字符一致，因此既有摘要不变；
 * 非法字节不会抛错，避免一个支持文件让所有新运行无法接纳。
 */
export function readSkillTextLossy(root: string, relativePath: string, maxBytes = SKILL_FILE_LIMIT): string {
  return new TextDecoder('utf-8').decode(readSkillBytes(root, relativePath, maxBytes));
}

export interface SkillFileInfo {
  readonly path: string;
  readonly size: number;
}

/**
 * 只用 readdir/lstat 检查整个包：路径、类型、数量、深度和单文件大小，不读取任何文件内容。
 * 目录发现每次调用都会走这里，所以代价必须与内容大小无关。
 */
export function inspectSkillFiles(root: string): SkillFileInfo[] {
  const result: SkillFileInfo[] = [];
  function visit(directory: string, prefix = '', depth = 0): void {
    if (depth > SKILL_DEPTH_LIMIT) throw new Error('Skill 资源目录超过 3 层');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (/[\\:\u0000-\u001f]/u.test(entry.name)) throw new Error('Skill 文件必须使用目录内的普通相对路径');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target, relative, depth + 1);
      else if (entry.isFile()) {
        const { size } = fs.lstatSync(target);
        if (size > SKILL_FILE_LIMIT) throw new Error(`资源文件过大（限制 ${SKILL_FILE_LIMIT} bytes）: ${relative}`);
        result.push({ path: relative, size });
        if (result.length > SKILL_RESOURCE_LIMIT + 1) throw new Error('Skill 最多包含 50 个支持文件');
      } else throw new Error('Skill 不支持符号链接或特殊文件');
    }
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Skill 根必须是普通目录');
  visit(root);
  return result;
}

export function listSkillFiles(root: string): string[] {
  return inspectSkillFiles(root).map(file => file.path);
}
