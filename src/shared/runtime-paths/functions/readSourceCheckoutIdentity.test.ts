import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { readSourceCheckoutIdentity } from './readSourceCheckoutIdentity';

const filesystem = vi.hoisted(() => ({
  shortRoot: String.raw`C:\Users\RUNNER~1\linnya`,
  nativeRoot: String.raw`C:\Users\runneradmin\linnya`,
}));
vi.mock('node:fs', () => ({
  realpathSync: Object.assign(() => filesystem.shortRoot, { native: () => filesystem.nativeRoot }),
}));
vi.mock('node:child_process', () => ({
  spawnSync: () => ({ status: 0, stdout: 'main\n' }),
}));

describe('source checkout native identity', () => {
  it('Windows 长名和8.3短名入口产生同一源码身份', () => {
    const short = readSourceCheckoutIdentity(path.win32.normalize(filesystem.shortRoot));
    const long = readSourceCheckoutIdentity(path.win32.normalize(filesystem.nativeRoot));
    expect(short).toEqual({ root: filesystem.nativeRoot, branch: 'main' });
    expect(long).toEqual(short);
  });
});
