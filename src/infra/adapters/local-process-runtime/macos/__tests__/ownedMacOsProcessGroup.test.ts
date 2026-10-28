import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  listMacOsProcessGroupMembers,
  parseMacOsProcessGroupListing,
  waitForMacOsProcessGroupEmpty,
} from '../functions/ownedMacOsProcessGroup';

describe('parseMacOsProcessGroupListing', () => {
  it('接受逐行十进制 PID 与末尾换行', () => {
    expect(parseMacOsProcessGroupListing('101\n202\n')).toEqual([101, 202]);
    expect(parseMacOsProcessGroupListing('303')).toEqual([303]);
    expect(parseMacOsProcessGroupListing('')).toEqual([]);
  });

  it('任何非 PID 内容都不能当成成员事实', () => {
    for (const stdout of ['abc\n', '101\n\n', ' 101\n', '0\n', '-1\n', '101 202\n', '9007199254740993\n']) {
      expect(parseMacOsProcessGroupListing(stdout)).toBeNull();
    }
  });
});

describe.skipIf(globalThis.process.platform !== 'darwin')('listMacOsProcessGroupMembers', () => {
  it('列出真实进程组成员，组清空后返回空列表', async () => {
    const child = spawn('/bin/sleep', ['5'], { detached: true, stdio: 'ignore' });
    const processGroupId = await new Promise<number>((resolve, reject) => {
      child.once('spawn', () => (child.pid ? resolve(child.pid) : reject(new Error('missing pid'))));
      child.once('error', reject);
    });
    try {
      await expect(listMacOsProcessGroupMembers(processGroupId)).resolves.toEqual([processGroupId]);
    } finally {
      process.kill(-processGroupId, 'SIGKILL');
    }
    await expect(waitForMacOsProcessGroupEmpty(processGroupId, 2_000)).resolves.toBe(true);
    await expect(listMacOsProcessGroupMembers(processGroupId)).resolves.toEqual([]);
  });
});
