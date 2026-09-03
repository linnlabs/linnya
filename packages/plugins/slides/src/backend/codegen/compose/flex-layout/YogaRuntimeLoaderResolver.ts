import { createRequire } from 'node:module';
import path from 'node:path';
import type { Yoga as YogaModule } from 'yoga-layout/load';

const YOGA_RUNTIME_LOADER_RELATIVE_PATH = './yogaRuntimeLoader.cjs';
const YOGA_RUNTIME_LOADER_SOURCE_PATH = path.join(
  'packages',
  'plugins',
  'slides',
  'src',
  'backend',
  'codegen',
  'compose',
  'flex-layout',
  'yogaRuntimeLoader.cjs',
);

export interface YogaRuntimeLoaderModule {
  loadYoga(): Promise<YogaModule>;
}

export type CjsRequire = (id: string) => unknown;
export type CreateRequireFactory = (filename: string | URL) => CjsRequire;

interface ReadYogaRuntimeLoaderOptions {
  cjsRequire?: CjsRequire | null;
  createRequireFactory?: CreateRequireFactory;
  cwd?: string;
}

export function readYogaRuntimeLoader(
  options: ReadYogaRuntimeLoaderOptions = {},
): YogaRuntimeLoaderModule {
  const cjsRequire = options.cjsRequire === undefined ? readAmbientRequire() : options.cjsRequire;
  const loaderCandidate =
    typeof cjsRequire === 'function'
      ? cjsRequire(YOGA_RUNTIME_LOADER_RELATIVE_PATH)
      : loadYogaRuntimeLoaderFromSource(options.cwd, options.createRequireFactory ?? createRequire);

  if (isYogaRuntimeLoaderModule(loaderCandidate)) {
    return loaderCandidate;
  }
  throw new Error('yogaRuntimeLoader.cjs 未导出 loadYoga()。');
}

function loadYogaRuntimeLoaderFromSource(
  cwd: string | undefined,
  createRequireFactory: CreateRequireFactory,
): unknown {
  const workspaceRoot = typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd();
  const loaderPath = path.resolve(workspaceRoot, YOGA_RUNTIME_LOADER_SOURCE_PATH);
  return createRequireFactory(loaderPath)(loaderPath);
}

function readAmbientRequire(): CjsRequire | undefined {
  return typeof require === 'function' ? require : undefined;
}

function isYogaRuntimeLoaderModule(value: unknown): value is YogaRuntimeLoaderModule {
  if (!value || typeof value !== 'object') return false;
  return typeof Reflect.get(value, 'loadYoga') === 'function';
}
