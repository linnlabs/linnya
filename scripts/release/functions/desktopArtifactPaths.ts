import path from 'node:path';

import type { ReleasePackageInfo } from '../definitions/releaseManifest';
import { readReleasePackageInfo } from './readPackageVersion';

export interface DesktopArtifactPaths {
  readonly appRoot: string;
  readonly asarPath: string;
  readonly evidenceBaseName: string;
  readonly outputRoot: string;
  readonly packageInfo: ReleasePackageInfo;
}

export function resolveDesktopArtifactPaths(input: {
  readonly architecture: 'arm64' | 'x64';
  readonly platform: 'darwin' | 'win32';
  readonly rootDir: string;
}): DesktopArtifactPaths {
  if (
    (input.platform === 'darwin' && input.architecture !== 'arm64') ||
    (input.platform === 'win32' && input.architecture !== 'x64')
  ) {
    throw new Error(`不支持的 Desktop 发布目标：${input.platform}/${input.architecture}`);
  }
  const packageInfo = readReleasePackageInfo(input.rootDir);
  const outputRoot = path.join(input.rootDir, 'dist_build', 'dist_electron');
  const appRoot =
    input.platform === 'darwin'
      ? path.join(outputRoot, 'mac-arm64', `${packageInfo.productName}.app`)
      : path.join(outputRoot, 'win-unpacked');
  return {
    packageInfo,
    outputRoot,
    appRoot,
    asarPath:
      input.platform === 'darwin'
        ? path.join(appRoot, 'Contents', 'Resources', 'app.asar')
        : path.join(appRoot, 'resources', 'app.asar'),
    evidenceBaseName: `linnya-desktop-${packageInfo.version}.${input.platform}-${input.architecture}`,
  };
}
