import { describe, expect, it } from 'vitest';

import { resolveProductionDataRoot } from './resolveProductionDataRoot';

describe('resolveProductionDataRoot', () => {
  it('macOS 放在 Application Support 的应用目录下', () => {
    expect(resolveProductionDataRoot({
      platform: 'darwin',
      userDataDirectory: '/Users/me/Library/Application Support/linnya',
      homeDirectory: '/Users/me',
    })).toBe('/Users/me/Library/Application Support/linnya/Workspace');
  });

  it('Windows 放在 Local AppData，不放会随漫游配置同步的 Roaming', () => {
    expect(resolveProductionDataRoot({
      platform: 'win32',
      userDataDirectory: 'C:\\Users\\me\\AppData\\Roaming\\linnya',
      homeDirectory: 'C:\\Users\\me',
      localAppDataDirectory: 'C:\\Users\\me\\AppData\\Local',
    })).toBe('C:\\Users\\me\\AppData\\Local\\linnya\\Workspace');
  });

  it('Windows 缺少 LOCALAPPDATA 时失败，不回退到 Roaming 或文稿', () => {
    expect(() => resolveProductionDataRoot({
      platform: 'win32',
      userDataDirectory: 'C:\\Users\\me\\AppData\\Roaming\\linnya',
      homeDirectory: 'C:\\Users\\me',
    })).toThrow('LOCALAPPDATA');
  });

  it('其他平台遵循 XDG 数据目录', () => {
    expect(resolveProductionDataRoot({
      platform: 'linux',
      userDataDirectory: '/home/me/.config/linnya',
      homeDirectory: '/home/me',
    })).toBe('/home/me/.local/share/linnya/Workspace');
    expect(resolveProductionDataRoot({
      platform: 'linux',
      userDataDirectory: '/home/me/.config/linnya',
      homeDirectory: '/home/me',
      xdgDataHome: '/data/me',
    })).toBe('/data/me/linnya/Workspace');
  });

  it('不同应用目录（如验收安装）得到互相隔离的数据根', () => {
    const input = { platform: 'darwin' as const, homeDirectory: '/Users/me' };
    expect(resolveProductionDataRoot({ ...input, userDataDirectory: '/Users/me/Library/Application Support/linnya-update-e2e' }))
      .not.toBe(resolveProductionDataRoot({ ...input, userDataDirectory: '/Users/me/Library/Application Support/linnya' }));
  });
});
