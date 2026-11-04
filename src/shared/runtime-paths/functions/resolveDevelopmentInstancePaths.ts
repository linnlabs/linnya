import path from 'node:path';

/** 源码身份与可写实例分离；相对覆盖始终以源码根解析，不能跟随 Backend cwd。 */
export function resolveDevelopmentInstancePaths(developmentRoot: string, instanceRootOverride?: string) {
  const instanceRoot = path.resolve(developmentRoot, instanceRootOverride?.trim() || '.');
  return Object.freeze({
    instanceRoot,
    appDataRoot: path.join(instanceRoot, '_dev_data'),
    profileRoot: path.join(instanceRoot, '_dev_electron'),
  });
}
