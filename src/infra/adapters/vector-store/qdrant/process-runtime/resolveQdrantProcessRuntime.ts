import fs from 'node:fs';
import path from 'node:path';

import { QdrantRuntimeMissingError, type QdrantProcessRuntime } from './qdrantProcessRuntime';

const PROXY_ENVIRONMENT_NAMES = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
]);

export function resolveQdrantProcessRuntime(input: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly mainBundleDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly hostEnvironment: Readonly<Record<string, string>>;
  /** Host 注入：返回已安装且复核通过的运行时组件可执行文件；没有或复核失败时返回 null。 */
  readonly resolveInstalledExecutable?: () => Promise<string | null>;
}): QdrantProcessRuntime {
  const binaryName = input.platform === 'win32' ? 'qdrant.exe' : 'qdrant';
  let developmentPlatformDirectory: string;
  if (input.platform === 'darwin' && input.architecture === 'arm64') {
    developmentPlatformDirectory = 'mac-arm64';
  } else if (input.platform === 'win32' && input.architecture === 'x64') {
    developmentPlatformDirectory = 'win-x64';
  } else {
    throw new Error(`Qdrant process runtime 不支持 ${input.platform}/${input.architecture}`);
  }

  const pathApi = input.platform === 'win32' ? path.win32 : path.posix;
  const binaryPath = input.packaged
    ? pathApi.join(input.resourcesPath, 'bin', 'qdrant', binaryName)
    : pathApi.resolve(
        input.mainBundleDirectory,
        '..',
        '..',
        'extraResources',
        'bin',
        'qdrant',
        developmentPlatformDirectory,
        binaryName,
      );
  const environmentEntries = Object.entries(input.hostEnvironment).filter(
    ([name]) => !PROXY_ENVIRONMENT_NAMES.has(name.toUpperCase()),
  );
  const environment = Object.freeze({
    ...Object.fromEntries(environmentEntries),
    QDRANT__TELEMETRY_DISABLED: 'true',
  });

  const resolveInstalledExecutable = input.resolveInstalledExecutable;
  return Object.freeze({
    binaryPath,
    platform: input.platform,
    environment,
    async resolveExecutable(): Promise<string> {
      const installed = resolveInstalledExecutable ? await resolveInstalledExecutable() : null;
      if (installed) return installed;
      if (fs.existsSync(binaryPath)) return binaryPath;
      throw new QdrantRuntimeMissingError();
    },
  });
}
