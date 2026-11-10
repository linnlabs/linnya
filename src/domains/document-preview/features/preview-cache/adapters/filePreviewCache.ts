import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { DocumentPreviewContentSchema, type DocumentPreviewContent } from '@app/schemas';
import { ZodError } from 'zod';
import type { DocumentPreviewCache } from '../../../definitions/documentPreview';

/** 派生缓存与正文分离。文件仅由内容键生成，不接受插件提供的路径。 */
export function createFilePreviewCache(directory: string, budgetBytes = 64 * 1024 * 1024): DocumentPreviewCache {
  const fileName = (key: string) => createHash('sha256').update(key).digest('hex') + '.json';
  return {
    async read(key) {
      const location = path.join(directory, fileName(key));
      try {
        const value = DocumentPreviewContentSchema.parse(JSON.parse(await readFile(location, 'utf8')));
        const now = new Date();
        await utimes(location, now, now);
        return value;
      }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        // 缓存是可重建派生；格式损坏只淘汰该条，权限或磁盘错误仍交给调用方。
        if (error instanceof SyntaxError || error instanceof ZodError) {
          await unlink(location); return null;
        }
        throw error;
      }
    },
    async write(key, content: DocumentPreviewContent) {
      await mkdir(directory, { recursive: true });
      const target = path.join(directory, fileName(key));
      const temp = path.join(directory, `${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(content));
      await rename(temp, target);
      const entries = await Promise.all((await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
        const location = path.join(directory, name);
        const info = await stat(location);
        return { location, size: info.size, time: info.mtimeMs };
      }));
      let total = entries.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of entries.sort((a, b) => a.time - b.time)) {
        if (total <= budgetBytes) break;
        await unlink(entry.location);
        total -= entry.size;
      }
    },
  };
}
