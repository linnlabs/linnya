import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { configureDevelopmentAppProfile } from '../orchestration/configureDevelopmentAppProfile';

describe('开发 profile 准入', () => {
  it('同一源码目录的实例使用各自 profile，显式 user-data-dir 仍优先', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'linnya-profile-')));
    try {
      const app = { isPackaged: false, commandLine: { hasSwitch: () => false },
        getPath: () => root, setPath: vi.fn() };
      for (const name of ['a', 'b']) {
        const profile = configureDevelopmentAppProfile({ app, developmentMode: true,
          developmentRoot: root, developmentInstanceRootOverride: name });
        expect(profile).toBe(path.join(root, name, '_dev_electron'));
      }
      expect(app.setPath.mock.calls).toHaveLength(4);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('保留显式 profile 与现有数据，发布包不受开发目录影响', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'linnya-profile-')));
    const userData = path.join(root, 'explicit-profile');
    const app = {
      isPackaged: false,
      commandLine: { hasSwitch: () => true },
      getPath: () => userData,
      setPath: vi.fn(),
    };
    const marker = path.join(root, 'existing-data');
    await writeFile(marker, 'keep');
    try {
      expect(configureDevelopmentAppProfile({ app, developmentMode: true, developmentRoot: root }))
        .toBe(userData);
      expect(app.setPath.mock.calls).toEqual([
        ['userData', userData], ['sessionData', path.join(userData, 'session')],
      ]);
      expect(await readFile(marker, 'utf8')).toBe('keep');
      app.isPackaged = true;
      app.setPath.mockClear();
      expect(configureDevelopmentAppProfile({ app, developmentMode: true, developmentRoot: '/absent' }))
        .toBeNull();
      expect(app.setPath).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
