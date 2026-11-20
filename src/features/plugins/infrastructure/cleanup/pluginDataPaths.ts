import fs from 'node:fs';
import path from 'node:path';

export function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT';
}

/** 保证每个路径分量都是实际目录；不能借链接跳到其他存储边界。 */
export function assertPluginDataDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  const segments = relative.split(path.sep);
  if (!relative || segments[0] === '..' || path.isAbsolute(relative)) {
    throw new Error(`插件数据目录不能越出数据根: ${target}`);
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) return false;
    if (!stat.isDirectory()) throw new Error(`插件数据路径不是实际目录: ${current}`);
  }
  return true;
}
