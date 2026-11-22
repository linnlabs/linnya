import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertAvailableDiskSpace, DISK_SPACE_MARGIN_BYTES } from './assertAvailableDiskSpace';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-space-'));
  roots.push(directory);
  return directory;
}

const statfsWith = (availableBytes: number) => async () => ({ bavail: BigInt(availableBytes), bsize: 1n });

describe('下载前磁盘空间预检', () => {
  it('同一卷上的需求合并计算：可用空间恰好等于需求加余量时通过，少一个字节失败并给出数字', async () => {
    const directory = root();
    const requirements = [
      { directory: path.join(directory, 'plugins', 'knowledge'), bytes: 1_000 },
      { directory: path.join(directory, 'runtimes'), bytes: 2_000 },
    ];
    const required = 3_000 + DISK_SPACE_MARGIN_BYTES;
    await expect(assertAvailableDiskSpace(requirements, { statfs: statfsWith(required) })).resolves.toBeUndefined();
    await expect(assertAvailableDiskSpace(requirements, { statfs: statfsWith(required - 1) })).rejects.toMatchObject({
      code: 'disk-space',
      diskSpace: { requiredBytes: required, availableBytes: required - 1 },
    });
  });

  it('目录尚不存在时按最近的已存在上级目录查询；需求为 0 时不查询', async () => {
    const directory = root();
    const queried: string[] = [];
    await assertAvailableDiskSpace(
      [{ directory: path.join(directory, 'a', 'b', 'c'), bytes: 1 }, { directory: '/definitely/not/here', bytes: 0 }],
      { statfs: async target => { queried.push(target); return { bavail: 1n << 40n, bsize: 1n }; } },
    );
    expect(queried).toEqual([directory]);
  });

  it('平台不支持 statfs 时跳过预检（写入阶段仍会识别 ENOSPC）', async () => {
    await expect(assertAvailableDiskSpace([{ directory: root(), bytes: 1 }], {
      statfs: async () => { throw Object.assign(new Error('not supported'), { code: 'ENOSYS' }); },
    })).resolves.toBeUndefined();
  });
});
