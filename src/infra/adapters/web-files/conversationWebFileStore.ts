import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { WebAcquiredFileSchema } from '@app/schemas';
import type { WebFileStore } from '../../../tools/web/webread/file-acquisition/definitions/webFileAcquisition';

export const WEB_FILE_CONVERSATION_MAX_BYTES = 50 * 1024 * 1024;
const pending = new Map<string, Promise<unknown>>();
const MANAGED_WEB_FILE_NAME = /^[a-f0-9]{64}\.(?:pdf|csv|xlsx)$/;

/** 只序列化同目录的配额/复用事务；生命周期准入仍由 Host 拥有。 */
async function inDirectory<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pending.set(root, next);
  try {
    return await next;
  } finally {
    if (pending.get(root) === next) pending.delete(root);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** 输入只来自受控下载字节。远程文件名和路径不参与本地寻址。 */
export async function saveConversationWebFile(
  root: string,
  input: Parameters<WebFileStore['save']>[0],
  maxBytes = WEB_FILE_CONVERSATION_MAX_BYTES
): ReturnType<WebFileStore['save']> {
  input.signal?.throwIfAborted();
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const receipt = WebAcquiredFileSchema.parse({
    path: `web-downloads/${sha256}.${input.format}`,
    format: input.format,
    mimeType: input.mimeType,
    byteLength: input.bytes.byteLength,
    sha256,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    acquiredAt: input.acquiredAt,
    trust: 'untrusted_external_file',
  });
  return inDirectory(root, async () => {
    input.signal?.throwIfAborted();
    const canonicalRoot = await realpath(root);
    const dir = path.join(canonicalRoot, 'web-downloads');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(dir)) !== dir) {
      throw new Error('Web download directory must be a real directory inside the conversation.');
    }
    const target = path.join(canonicalRoot, receipt.path);
    try {
      const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const existingStat = await existing.stat();
        if (
          !existingStat.isFile() ||
          existingStat.size !== input.bytes.byteLength ||
          createHash('sha256')
            .update(await existing.readFile())
            .digest('hex') !== sha256
        ) {
          throw new Error(
            'Downloaded file was modified. Move the modified copy before acquiring the original again.'
          );
        }
        return receipt;
      } finally {
        await existing.close();
      }
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    let used = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      // Shell 解析产物并非 Web 受管原件；只检查存储层命名的候选，且不沿 symlink 计量。
      // 名称筛选不证明来源身份；实际复用仍由上方目标字节/hash 校验负责。
      if (!MANAGED_WEB_FILE_NAME.test(entry.name)) continue;
      const managedStat = await lstat(path.join(dir, entry.name));
      if (!managedStat.isFile() || managedStat.isSymbolicLink()) {
        throw new Error(
          'Managed Web download entry must be a regular file, not a directory or symbolic link.'
        );
      }
      used += managedStat.size;
    }
    if (used + input.bytes.byteLength > maxBytes) {
      throw new Error(
        `Conversation Web download quota exceeded: used=${used} bytes, incoming=${input.bytes.byteLength} bytes, max=${maxBytes} bytes. Remove unneeded originals before retrying; keep parsed outputs outside web-downloads/.`
      );
    }
    input.signal?.throwIfAborted();
    const staging = path.join(dir, `.acquiring-${randomUUID()}`);
    const handle = await open(
      staging,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.writeFile(input.bytes);
      input.signal?.throwIfAborted();
      // 完整写入后才公布 hash 路径；link 不覆盖 Shell 已写入的同名文件。
      await link(staging, target);
    } finally {
      await handle.close();
      await unlink(staging);
    }
    return receipt;
  });
}
