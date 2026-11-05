import { describe, expect, it } from 'vitest';

import { resolveBackendRuntimePathRoots } from './resolveBackendRuntimePathRoots';

describe('resolveBackendRuntimePathRoots', () => {
  it('开发态让 AppData 与默认 Workspace 继续共用 _dev_data', () => {
    expect(
      resolveBackendRuntimePathRoots({
        developmentRoot: '/workspace/linnya',
        userDataDirectory: '/ignored/user-data',
        productionDataRoot: '/ignored/production-data',
        developmentMode: true,
      })
    ).toEqual({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/workspace/linnya/_dev_data',
      workspaceRoot: '/workspace/linnya/_dev_data',
      workspaceRootIsCustom: false,
      profileRoot: '/ignored/user-data',
    });
  });

  it('一次性实例移动全部默认运行数据，并允许另设 Workspace', () => {
    const input = {
      developmentRoot: '/workspace/linnya',
      userDataDirectory: '/disposable/_dev_electron',
      productionDataRoot: '/disposable/_dev_electron/Workspace',
      developmentMode: true,
      developmentInstanceRootOverride: '../disposable',
    };
    expect(resolveBackendRuntimePathRoots(input)).toMatchObject({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/workspace/disposable/_dev_data',
      workspaceRoot: '/workspace/disposable/_dev_data',
      profileRoot: '/disposable/_dev_electron',
    });
    expect(resolveBackendRuntimePathRoots({ ...input, workspaceRootOverride: './workspace' }))
      .toMatchObject({ workspaceRoot: '/workspace/linnya/workspace', workspaceRootIsCustom: true });
    expect(resolveBackendRuntimePathRoots({ ...input, developmentMode: false })).toMatchObject({
      appDataRoot: '/disposable/_dev_electron/Workspace',
      workspaceRoot: '/disposable/_dev_electron/Workspace',
    });
  });

  it('正式版把 AppData 与默认 Workspace 放在同一个用户数据根，profile 留在 userData', () => {
    expect(
      resolveBackendRuntimePathRoots({
        developmentRoot: '/workspace/linnya',
        userDataDirectory: '/users/me/Library/Application Support/linnya',
        productionDataRoot: '/users/me/Library/Application Support/linnya/Workspace',
        developmentMode: false,
      })
    ).toEqual({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/users/me/Library/Application Support/linnya/Workspace',
      workspaceRoot: '/users/me/Library/Application Support/linnya/Workspace',
      workspaceRootIsCustom: false,
      profileRoot: '/users/me/Library/Application Support/linnya',
    });
  });

  it('正式版固定相对 Workspace 覆盖的解析基准，AppData 不随覆盖移动', () => {
    expect(
      resolveBackendRuntimePathRoots({
        developmentRoot: '/workspace/linnya',
        userDataDirectory: '/users/me/app-data/linnya',
        productionDataRoot: '/users/me/app-data/linnya/Workspace',
        developmentMode: false,
        workspaceRootOverride: './disposable-workspace',
      })
    ).toMatchObject({
      appDataRoot: '/users/me/app-data/linnya/Workspace',
      workspaceRoot: '/workspace/linnya/disposable-workspace',
      workspaceRootIsCustom: true,
    });
  });

  it('正式运行缺少用户数据根时直接失败，不回退到文稿或 cwd', () => {
    expect(() =>
      resolveBackendRuntimePathRoots({
        developmentRoot: '/workspace/linnya',
        userDataDirectory: '/users/me/app-data/linnya',
        developmentMode: false,
      })
    ).toThrow('productionDataRoot');
  });
});
