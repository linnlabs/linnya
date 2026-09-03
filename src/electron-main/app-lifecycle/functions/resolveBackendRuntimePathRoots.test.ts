import { describe, expect, it } from 'vitest';

import { resolveBackendRuntimePathRoots } from './resolveBackendRuntimePathRoots';

describe('resolveBackendRuntimePathRoots', () => {
  it('开发态让 AppData 与默认 Workspace 继续共用 _dev_data', () => {
    expect(
      resolveBackendRuntimePathRoots({
        developmentRoot: '/workspace/linnya',
        userDataDirectory: '/ignored/user-data',
        documentsDirectory: '/ignored/documents',
        developmentMode: true,
      })
    ).toEqual({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/workspace/linnya/_dev_data',
      workspaceRoot: '/workspace/linnya/_dev_data',
      workspaceRootIsCustom: false,
    });
  });

  it('生产态由 Desktop Host 决定 Electron 目录，并固定相对 Workspace 覆盖的解析基准', () => {
    expect(
      resolveBackendRuntimePathRoots({
        developmentRoot: '/workspace/linnya',
        userDataDirectory: '/users/me/app-data/Linnya',
        documentsDirectory: '/users/me/Documents',
        developmentMode: false,
        workspaceRootOverride: './disposable-workspace',
      })
    ).toEqual({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/users/me/app-data/Linnya/AIService',
      workspaceRoot: '/workspace/linnya/disposable-workspace',
      workspaceRootIsCustom: true,
    });
  });
});
