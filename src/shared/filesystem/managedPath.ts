import path from 'node:path';

/** candidate 必须是 root 的后代，root 自身不代表一个可读取内容文件。 */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative);
}
