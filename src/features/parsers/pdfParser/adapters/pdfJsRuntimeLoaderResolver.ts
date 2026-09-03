import { createRequire } from 'node:module';
import path from 'node:path';
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.js';

const RUNTIME_LOADER_RELATIVE_PATH = './pdfJsRuntimeLoader.cjs';
const RUNTIME_LOADER_SOURCE_PATH = path.join(
  'src',
  'features',
  'parsers',
  'pdfParser',
  'adapters',
  'pdfJsRuntimeLoader.cjs',
);

interface PdfJsRuntimeLoader {
  loadPdfJs(): Promise<typeof PdfJsModule>;
}

type CjsRequire = (id: string) => unknown;
type CreateRequireFactory = (filename: string | URL) => CjsRequire;

interface ReadPdfJsRuntimeLoaderOptions {
  cjsRequire?: CjsRequire | null;
  createRequireFactory?: CreateRequireFactory;
  cwd?: string;
}

export function readPdfJsRuntimeLoader(
  options: ReadPdfJsRuntimeLoaderOptions = {},
): PdfJsRuntimeLoader {
  const cjsRequire = options.cjsRequire === undefined ? readAmbientRequire() : options.cjsRequire;
  const candidate =
    typeof cjsRequire === 'function'
      ? cjsRequire(RUNTIME_LOADER_RELATIVE_PATH)
      : readLoaderFromSource(options.cwd, options.createRequireFactory ?? createRequire);

  if (isPdfJsRuntimeLoader(candidate)) return candidate;
  throw new Error('pdfJsRuntimeLoader.cjs 未导出 loadPdfJs()。');
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

function isPdfJsRuntimeLoader(value: unknown): value is PdfJsRuntimeLoader {
  return value != null
    && typeof value === 'object'
    && typeof Reflect.get(value, 'loadPdfJs') === 'function';
}
