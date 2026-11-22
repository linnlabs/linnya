import fs from 'node:fs';
import path from 'node:path';

import { PluginOperationError } from '../definitions/pluginOperationError';

/** 预留余量：文件系统块对齐、元数据与回执写入。 */
export const DISK_SPACE_MARGIN_BYTES = 16 * 1024 * 1024;

export interface DiskSpaceRequirement {
  /** 将要写入的目录；不存在时按最近的已存在上级目录所在卷计算。 */
  readonly directory: string;
  readonly bytes: number;
}

function nearestExistingDirectory(directory: string): string {
  let current = path.resolve(directory);
  for (;;) {
    if (fs.statSync(current, { throwIfNoEntry: false })?.isDirectory()) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/**
 * 下载前预检磁盘空间：同一卷上的需求合并计算，任一卷不足即抛出 disk-space，并附上需要与剩余字节数。
 * 平台不支持 statfs 时跳过预检，写入阶段的 ENOSPC 仍会被归类为 disk-space。
 */
export async function assertAvailableDiskSpace(
  requirements: readonly DiskSpaceRequirement[],
  options: { readonly statfs?: (directory: string) => Promise<{ readonly bavail: number | bigint; readonly bsize: number | bigint }> } = {},
): Promise<void> {
  const statfs = options.statfs ?? (directory => fs.promises.statfs(directory));
  const volumes = new Map<string, { directory: string; bytes: number }>();
  for (const requirement of requirements) {
    if (requirement.bytes <= 0) continue;
    const directory = nearestExistingDirectory(requirement.directory);
    const device = String(fs.statSync(directory).dev);
    const volume = volumes.get(device) ?? { directory, bytes: 0 };
    volume.bytes += requirement.bytes;
    volumes.set(device, volume);
  }
  for (const volume of volumes.values()) {
    let stats: { readonly bavail: number | bigint; readonly bsize: number | bigint };
    try {
      stats = await statfs(volume.directory);
    } catch {
      continue;
    }
    const availableBytes = Number(BigInt(stats.bavail) * BigInt(stats.bsize));
    const requiredBytes = volume.bytes + DISK_SPACE_MARGIN_BYTES;
    if (availableBytes < requiredBytes) {
      throw new PluginOperationError(
        'disk-space',
        `磁盘空间不足: 需要 ${requiredBytes} 字节，可用 ${availableBytes} 字节 (${volume.directory})`,
        { diskSpace: { requiredBytes, availableBytes } },
      );
    }
  }
}
