import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

/** 目录内匹配的条目超出预算时，从最久未用的开始删。读取命中时调用方会更新修改时间，所以按修改时间就是按最近使用。 */
export async function evictOldestCacheFiles(
  directory: string,
  entryName: RegExp,
  budgetBytes: number
): Promise<void> {
  const entries = await Promise.all(
    (await readdir(directory))
      .filter(name => entryName.test(name))
      .map(async name => {
        const location = path.join(directory, name);
        const info = await stat(location);
        return { location, size: info.size, time: info.mtimeMs };
      })
  );
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries.sort((a, b) => a.time - b.time)) {
    if (total <= budgetBytes) break;
    await unlink(entry.location);
    total -= entry.size;
  }
}
