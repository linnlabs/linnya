import path from 'node:path';

export function resolvePluginCliClientPath(input: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly mainBundleDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
}): string {
  if (input.platform === 'darwin' && input.architecture === 'arm64') {
    const join = path.posix.join;
    return input.packaged
      ? join(
          input.resourcesPath,
          'command-runtime',
          'plugin-cli',
          'darwin',
          'arm64',
          'linnya-plugin-cli-client',
        )
      : join(
          input.mainBundleDirectory,
          'plugin-cli-runtime',
          'darwin',
          'arm64',
          'linnya-plugin-cli-client',
        );
  }
  if (input.platform === 'win32' && input.architecture === 'x64') {
    const join = path.win32.join;
    return input.packaged
      ? join(
          input.resourcesPath,
          'command-runtime',
          'plugin-cli',
          'win32',
          'x64',
          'linnya-plugin-cli-client.exe',
        )
      : join(
          input.mainBundleDirectory,
          'plugin-cli-runtime',
          'win32',
          'x64',
          'linnya-plugin-cli-client.exe',
        );
  }
  throw new Error(
    `Plugin CLI client does not support ${input.platform}/${input.architecture}.`,
  );
}
