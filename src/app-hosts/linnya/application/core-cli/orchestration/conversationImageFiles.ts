import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatConversationFileLocator, parseFileLocator } from '@app/schemas';
import { inspectNodePhysicalRegularFile } from '../../../adapters/file-read';
import { PhysicalFileReadError, type PhysicalFileReaderPort } from '../../file-read';

/** Core CLI 处理出的图片都放这里，和 Agent 下载素材的推荐位置一致，引用时写 `conversation:/assets/...`。 */
const ASSET_DIRECTORY = 'assets';

/** 只认当前对话工作目录；Workspace 文档和宿主文件不是这里的图片来源。 */
function conversationPath(root: string, reference: string): string | null {
  if (!/^[a-z]+:/iu.test(reference)) return path.resolve(root, reference);
  try {
    const parsed = parseFileLocator(reference);
    return parsed.kind === 'conversation' ? path.resolve(root, ...parsed.relativePath.split('/')) : null;
  } catch {
    return null;
  }
}

/**
 * 读对话工作目录里的一张图。越界、符号链接指出目录、不是图片或不存在都返回 null，
 * 由调用方决定是跳过（配色取色）还是报错（素材处理）。
 */
export async function readConversationImage(
  reader: PhysicalFileReaderPort, root: string, reference: string, signal: AbortSignal,
): Promise<Uint8Array | null> {
  signal.throwIfAborted();
  const absolutePath = conversationPath(root, reference);
  if (!absolutePath) return null;
  try {
    const physical = await reader.readFile({ absolutePath, scope: { kind: 'conversation', rootPath: root } });
    return physical.kind === 'image_source' ? new Uint8Array(await readFile(physical.resolvedPath, { signal })) : null;
  } catch (error) {
    if (error instanceof PhysicalFileReadError) return null;
    throw error;
  }
}

/** CJK 书法字体常在 5–20MB，32MB 留了余量；再大多半不是单个字体文件。 */
const FONT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * 读对话工作目录里的字体文件。字体不是 read_file 的格式，这里只做与它相同的位置检查（不越界、不是符号链接、是普通文件）
 * 和大小上限，格式交给字体解析判断。读不到时返回 null。
 */
export async function readConversationFont(root: string, reference: string, signal: AbortSignal): Promise<Uint8Array | null> {
  signal.throwIfAborted();
  const absolutePath = conversationPath(root, reference);
  if (!absolutePath) return null;
  try {
    const inspected = await inspectNodePhysicalRegularFile({ absolutePath, scope: { kind: 'conversation', rootPath: root } });
    if (inspected.byteLength > FONT_MAX_BYTES) return null;
    return new Uint8Array(await readFile(inspected.resolvedPath, { signal }));
  } catch (error) {
    if (error instanceof PhysicalFileReadError) return null;
    throw error;
  }
}

export class ConversationAssetWriteError extends Error {
  readonly name = 'ConversationAssetWriteError';
}

/** 文件名取原图名（只留字母、数字、下划线和连字符），加操作名和随机后缀，不会撞上已有文件。 */
function assetFileName(stem: string, operation: string, extension: string): string {
  const base = path.basename(stem, path.extname(stem))
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40) || 'image';
  return `${base}-${operation}-${randomBytes(3).toString('hex')}.${extension}`;
}

/**
 * 写进工作目录的 `assets/`，返回 conversation locator。
 * `assets` 若是符号链接或不是文件夹就拒绝，文件独占创建：预先放好的链接不能把写入带到工作目录外。
 */
export async function writeConversationAsset(input: {
  readonly root: string;
  readonly stem: string;
  readonly operation: string;
  readonly extension: string;
  readonly bytes: Uint8Array;
  readonly signal: AbortSignal;
}): Promise<string> {
  const directory = path.join(input.root, ASSET_DIRECTORY);
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ConversationAssetWriteError(`${ASSET_DIRECTORY}/ 不是工作目录里的普通文件夹`);
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    await mkdir(directory);
  }
  const name = assetFileName(input.stem, input.operation, input.extension);
  await writeFile(path.join(directory, name), input.bytes, { flag: 'wx', mode: 0o600, signal: input.signal });
  return formatConversationFileLocator(`${ASSET_DIRECTORY}/${name}`);
}
