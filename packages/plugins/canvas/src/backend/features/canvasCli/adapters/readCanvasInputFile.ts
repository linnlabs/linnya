import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { CanvasCliFailure } from '../definitions/canvasCliCommand';

/** 受管 Shell 文件地址与 workspace VFS 分离；链接也不能越过本次会话目录。 */
export async function readCanvasInputFile(root: string, locator: string, signal: AbortSignal): Promise<Uint8Array> {
  const relativePath = locator.startsWith('conversation:/') ? locator.slice('conversation:/'.length) : locator;
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..') || relativePath.includes(':')) throw new CanvasCliFailure('outside_conversation', '输入文件必须在当前 conversation:/ 内。');
  const canonicalRoot = await realpath(root), target = await realpath(path.resolve(canonicalRoot, relativePath));
  const relative = path.relative(canonicalRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new CanvasCliFailure('outside_conversation', '输入文件链接指向会话目录外，已拒绝。');
  const metadata = await stat(target);
  if (!metadata.isFile() || metadata.size > 48 * 1024 * 1024) throw new CanvasCliFailure('invalid_file', '输入必须是小于 48 MiB 的普通文件。');
  return readFile(target, { signal });
}
