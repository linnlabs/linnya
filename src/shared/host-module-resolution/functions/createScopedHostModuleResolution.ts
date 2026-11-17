import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

function normalizeExistingPath(filePath: string): string {
  try { return fs.realpathSync.native(filePath); }
  catch { return path.resolve(filePath); }
}

/** 仅为已冻结 artifact 内的调用定位 Host 固定依赖，不接纳插件提供的名单或搜索路径。 */
export function createScopedHostModuleResolution(input: {
  readonly artifactDirectory: string;
  readonly hostModuleAnchor: string;
  readonly specifiers: ReadonlySet<string>;
}): (specifier: string, parentFilename: string | undefined) => string | undefined {
  const directory = normalizeExistingPath(input.artifactDirectory);
  const requireFromHost = createRequire(input.hostModuleAnchor);
  return (specifier, parentFilename) => {
    if (!input.specifiers.has(specifier) || !parentFilename) return undefined;
    const relative = path.relative(directory, normalizeExistingPath(parentFilename));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return undefined;
    }
    return requireFromHost.resolve(specifier);
  };
}
