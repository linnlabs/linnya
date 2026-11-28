import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewImageVariant,
  PreviewImageVariantCache,
} from '../../../definitions/documentPreview';
import { evictOldestCacheFiles } from '../functions/evictOldestCacheFiles';

const FORMATS = ['png', 'jpeg', 'webp'] as const;

/**
 * 缩好的预览图按“图片身份 + 档位”单独存盘，与预览正文的缓存分开计上限：
 * 正文只有几十 KB，图片每张可到 MB 级，放在同一个预算里一篇带图文档就会把别的文档全部挤掉。
 * 文件首字节记录编码格式，其后是图片字节；可整目录删除重建。
 */
export function createFileImageVariantCache(
  directory: string,
  budgetBytes = 256 * 1024 * 1024
): PreviewImageVariantCache {
  const fileName = (key: string) => createHash('sha256').update(key).digest('hex') + '.img';
  return {
    async read(key) {
      const location = path.join(directory, fileName(key));
      let file: Buffer;
      try {
        file = await readFile(location);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      }
      const format = FORMATS[file[0]];
      // 派生缓存可重建；格式字节不认识或没有内容时只淘汰该条，按未命中处理。
      if (!format || file.length < 2) {
        await unlink(location);
        return null;
      }
      const now = new Date();
      await utimes(location, now, now);
      // 复制出独立缓冲区：小文件的 Buffer 可能与别的读取共用同一块内存。
      return { format, bytes: new Uint8Array(file.subarray(1)) };
    },
    async write(key, variant: PreviewImageVariant) {
      await mkdir(directory, { recursive: true });
      const temp = path.join(directory, `${randomUUID()}.tmp`);
      await writeFile(
        temp,
        Buffer.concat([Buffer.from([FORMATS.indexOf(variant.format)]), variant.bytes])
      );
      await rename(temp, path.join(directory, fileName(key)));
      await evictOldestCacheFiles(directory, /^[a-f0-9]{64}\.img$/, budgetBytes);
    },
  };
}
