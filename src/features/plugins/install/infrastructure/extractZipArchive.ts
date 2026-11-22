import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';

import { PluginOperationError } from '../definitions/pluginOperationError';

/** 没有声明解压后大小的来源（开发用 latest.json）也要有上限，防止压缩炸弹写满磁盘。 */
export const DEFAULT_MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;

export function resolveInsideDirectory(rootDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new PluginOperationError('artifact-integrity', `插件 zip 路径不能越界: ${relativePath}`);
  }

  const resolved = path.resolve(rootDir, ...normalized.split('/'));
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PluginOperationError('artifact-integrity', `插件 zip 路径不能越界: ${relativePath}`);
  }
  return resolved;
}

/**
 * 逐条目流式解压，累计写出的真实字节数（不信任 zip 头里声明的大小），超过上限立即中止。
 * catalog 来源传入签名声明的 unpackedSize：多出一个字节都说明包体与发布时不一致。
 */
export async function extractZipToDirectory(
  zipPath: string,
  targetDir: string,
  options: { readonly maxUnpackedBytes?: number } = {},
): Promise<{ readonly unpackedBytes: number }> {
  const limit = options.maxUnpackedBytes ?? DEFAULT_MAX_UNPACKED_BYTES;
  const zip = await JSZip.loadAsync(await fs.promises.readFile(zipPath));
  let total = 0;

  for (const entry of Object.values(zip.files)) {
    const targetPath = resolveInsideDirectory(targetDir, entry.name);
    if (entry.dir) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        if (total > limit) {
          callback(new PluginOperationError('artifact-integrity', `解压后大小超过上限: limit=${limit}，已写出>${limit}`));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(entry.nodeStream('nodebuffer'), counter, fs.createWriteStream(targetPath));
  }
  return { unpackedBytes: total };
}
