import { createRequire } from 'node:module';
import path from 'node:path';
import type * as HarfBuzzModule from 'harfbuzzjs';

const RUNTIME_LOADER_RELATIVE_PATH = './harfbuzzRuntimeLoader.cjs';
const RUNTIME_LOADER_SOURCE_PATH = path.join(
  'src',
  'features',
  'text-measurement',
  'infrastructure',
  'system',
  'harfbuzzRuntimeLoader.cjs',
);

export interface HarfBuzzRuntimeLoader {
  loadHarfBuzz(): Promise<typeof HarfBuzzModule>;
}

type CjsRequire = (id: string) => unknown;
type CreateRequireFactory = (filename: string | URL) => CjsRequire;

interface ReadHarfBuzzRuntimeLoaderOptions {
  cjsRequire?: CjsRequire | null;
  createRequireFactory?: CreateRequireFactory;
  cwd?: string;
}

export function readHarfBuzzRuntimeLoader(
  options: ReadHarfBuzzRuntimeLoaderOptions = {},
): HarfBuzzRuntimeLoader {
  const cjsRequire = options.cjsRequire === undefined ? readAmbientRequire() : options.cjsRequire;
  const candidate =
    typeof cjsRequire === 'function'
      ? cjsRequire(RUNTIME_LOADER_RELATIVE_PATH)
      : readLoaderFromSource(options.cwd, options.createRequireFactory ?? createRequire);

  if (isHarfBuzzRuntimeLoader(candidate)) return candidate;
  throw new Error('harfbuzzRuntimeLoader.cjs 未导出 loadHarfBuzz()。');
}

function readLoaderFromSource(
  cwd: string | undefined,
  createRequireFactory: CreateRequireFactory,
): unknown {
  const workspaceRoot = typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd();
  const loaderPath = path.resolve(workspaceRoot, RUNTIME_LOADER_SOURCE_PATH);
  return createRequireFactory(loaderPath)(loaderPath);
}

function readAmbientRequire(): CjsRequire | undefined {
  return typeof require === 'function' ? require : undefined;
}

function isHarfBuzzRuntimeLoader(value: unknown): value is HarfBuzzRuntimeLoader {
  return value != null
    && typeof value === 'object'
    && typeof Reflect.get(value, 'loadHarfBuzz') === 'function';
}
