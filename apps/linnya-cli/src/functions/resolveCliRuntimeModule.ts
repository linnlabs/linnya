import fs from 'node:fs';
import path from 'node:path';

const RUNTIME_MODULE_FILE = 'linnya-cli-runtime.cjs';

export function resolveCliRuntimeModule(input: {
  readonly processEntryPath: string | undefined;
  readonly workingDirectory: string;
  readonly configuredModulePath: string | undefined;
  readonly configuredDevelopmentRoot: string | undefined;
}): { readonly modulePath: string; readonly developmentRoot: string } {
  const configuredModulePath = input.configuredModulePath?.trim();
  if (configuredModulePath) {
    const modulePath = path.resolve(configuredModulePath);
    requireFile(modulePath);
    const developmentRoot = input.configuredDevelopmentRoot?.trim();
    if (!developmentRoot) {
      throw new Error('LINNYA_CLI_RUNTIME_MODULE 需要同时设置 LINNYA_CLI_DEVELOPMENT_ROOT');
    }
    return Object.freeze({ modulePath, developmentRoot: path.resolve(developmentRoot) });
  }

  const candidates: Array<{ readonly modulePath: string; readonly developmentRoot: string }> = [];
  candidates.push({
    modulePath: path.resolve(input.workingDirectory, 'dist', 'main', RUNTIME_MODULE_FILE),
    developmentRoot: path.resolve(input.workingDirectory),
  });
  const packageRoot = resolveCliPackageRoot(input.processEntryPath);
  if (packageRoot) {
    const repositoryRoot = path.resolve(packageRoot, '../..');
    candidates.push({
      modulePath: path.join(repositoryRoot, 'dist', 'main', RUNTIME_MODULE_FILE),
      developmentRoot: repositoryRoot,
    });
    candidates.push({
      modulePath: path.join(packageRoot, 'runtime', RUNTIME_MODULE_FILE),
      developmentRoot: path.resolve(packageRoot, '../..'),
    });
  }
  const found = candidates.find(candidate => isFile(candidate.modulePath));
  if (found) return Object.freeze(found);
  throw new Error('CLI Runtime bundle 不存在；请在 Linnya 仓库执行 pnpm build:linnya-runtime');
}

function resolveCliPackageRoot(processEntryPath: string | undefined): string | undefined {
  if (!processEntryPath) return undefined;
  const entryDirectory = path.dirname(path.resolve(processEntryPath));
  const leaf = path.basename(entryDirectory);
  return leaf === 'src' || leaf === 'bin' || leaf === 'dist'
    ? path.dirname(entryDirectory)
    : undefined;
}

function requireFile(filePath: string): void {
  if (!isFile(filePath)) throw new Error(`CLI Runtime bundle 不存在: ${filePath}`);
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}
