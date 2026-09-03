import path from 'node:path';

/** 在 Shell snapshot 冻结前一次性加入受管 facade 目录，不在每条命令里重读 PATH。 */
export function prependPluginCliLauncherPath(
  environment: Readonly<Record<string, string>>,
  directory: string,
): NodeJS.ProcessEnv {
  if (!path.isAbsolute(directory)) {
    throw new Error('Plugin CLI launcher directory must be absolute.');
  }
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  const existing = environment[pathKey];
  return {
    ...environment,
    [pathKey]: existing ? `${directory}${path.delimiter}${existing}` : directory,
  };
}
