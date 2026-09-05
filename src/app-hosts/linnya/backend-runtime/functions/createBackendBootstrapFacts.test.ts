import { describe, expect, it } from 'vitest';

import { createBackendBootstrapFacts } from './createBackendBootstrapFacts';

describe('createBackendBootstrapFacts', () => {
  it('冻结 data-only App owner 启动事实', () => {
    const facts = createBackendBootstrapFacts({
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: true,
      distributionIdentity: { kind: 'community', packaged: true },
      resourcesPath: '/Applications/Linnya.app/Contents/Resources',
      mainBundleDirectory: '/Applications/Linnya.app/Contents/Resources/app.asar/dist/main',
      runtimePathRoots: {
        developmentRoot: '/workspace/linnya',
        appDataRoot: '/users/me/app-data/Linnya/AIService',
        workspaceRoot: '/users/me/Documents/Linnya',
        workspaceRootIsCustom: false,
      },
      exposeProviderOutboundDebugRoutes: false,
    });

    expect(facts).toEqual({
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: true,
      distributionIdentity: { kind: 'community', packaged: true },
      resourcesPath: '/Applications/Linnya.app/Contents/Resources',
      mainBundleDirectory: '/Applications/Linnya.app/Contents/Resources/app.asar/dist/main',
      runtimePathRoots: {
        developmentRoot: '/workspace/linnya',
        appDataRoot: '/users/me/app-data/Linnya/AIService',
        workspaceRoot: '/users/me/Documents/Linnya',
        workspaceRootIsCustom: false,
      },
      exposeProviderOutboundDebugRoutes: false,
    });
    expect(Object.isFrozen(facts)).toBe(true);
  });

  it('拒绝相对运行资产路径', () => {
    expect(() => createBackendBootstrapFacts({
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: false,
      distributionIdentity: { kind: 'source', packaged: false },
      resourcesPath: 'resources',
      mainBundleDirectory: '/workspace/dist/main',
      runtimePathRoots: {
        developmentRoot: '/workspace/linnya',
        appDataRoot: '/users/me/app-data/Linnya/AIService',
        workspaceRoot: '/users/me/Documents/Linnya',
        workspaceRootIsCustom: false,
      },
      exposeProviderOutboundDebugRoutes: true,
    })).toThrow('resourcesPath 必须是绝对路径');
  });

  it('拒绝 packaged 与发行身份不一致', () => {
    expect(() => createBackendBootstrapFacts({
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: false,
      distributionIdentity: { kind: 'community', packaged: true },
      resourcesPath: '/resources',
      mainBundleDirectory: '/workspace/dist/main',
      runtimePathRoots: {
        developmentRoot: '/workspace/linnya',
        appDataRoot: '/users/me/app-data/Linnya/AIService',
        workspaceRoot: '/users/me/Documents/Linnya',
        workspaceRootIsCustom: false,
      },
      exposeProviderOutboundDebugRoutes: true,
    })).toThrow('packaged 与 distribution identity 不一致');
  });
});
