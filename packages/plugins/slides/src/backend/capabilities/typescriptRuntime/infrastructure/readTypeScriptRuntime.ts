import { createRequire } from 'node:module';
import path from 'node:path';

import type {
  SlidesTypeScriptCreateRequire,
  SlidesTypeScriptRuntime,
  SlidesTypeScriptRuntimeRequire,
} from '../definitions/typescriptRuntime.js';

const TYPESCRIPT_PACKAGE_ID = 'typescript';
const ARTIFACT_TYPESCRIPT_PACKAGE_ID = './node_modules/typescript';
const BACKEND_ARTIFACT_ENTRY_NAMES = new Set([
  'index.cjs',
  'presentation-build-worker.cjs',
]);
const SLIDES_PACKAGE_JSON_SOURCE_PATH = path.join('packages', 'plugins', 'slides', 'package.json');

export interface ReadSlidesTypeScriptRuntimeOptions {
  readonly cjsRequire?: SlidesTypeScriptRuntimeRequire | null;
  readonly createRequireFactory?: SlidesTypeScriptCreateRequire;
  readonly cwd?: string;
}

let cachedRuntime: SlidesTypeScriptRuntime | undefined;

/**
 * 第一次真正解析或检查 deck.js 时才加载 TypeScript。
 *
 * 中文说明：
 * - artifact CJS 使用入口自己的 require，只会命中 dist/backend/node_modules/typescript；
 * - source-development 使用 Slides package.json 作为明确解析锚点；
 * - 不搜索宿主根目录或全局安装，避免远程插件在开发机可用、发布后失效。
 */
export function getSlidesTypeScriptRuntime(): SlidesTypeScriptRuntime {
  if (!cachedRuntime) {
    cachedRuntime = readSlidesTypeScriptRuntime();
  }
  return cachedRuntime;
}

export function readSlidesTypeScriptRuntime(
  options: ReadSlidesTypeScriptRuntimeOptions = {}
): SlidesTypeScriptRuntime {
  const artifactRequire =
    options.cjsRequire === undefined ? readArtifactRequire() : options.cjsRequire;
  const candidate =
    typeof artifactRequire === 'function'
      ? artifactRequire(ARTIFACT_TYPESCRIPT_PACKAGE_ID)
      : loadSourceDevelopmentRuntime(options.cwd, options.createRequireFactory ?? createRequire);

  if (!isSlidesTypeScriptRuntime(candidate)) {
    throw new Error('Slides TypeScript runtime 未提供完整的 compiler API。');
  }
  return candidate;
}

function loadSourceDevelopmentRuntime(
  cwd: string | undefined,
  createRequireFactory: SlidesTypeScriptCreateRequire
): unknown {
  const workspaceRoot = typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd();
  const packageJsonPath = path.resolve(workspaceRoot, SLIDES_PACKAGE_JSON_SOURCE_PATH);
  return createRequireFactory(packageJsonPath)(TYPESCRIPT_PACKAGE_ID);
}

function readArtifactRequire(): SlidesTypeScriptRuntimeRequire | undefined {
  if (
    typeof require !== 'function' ||
    typeof __filename !== 'string' ||
    !BACKEND_ARTIFACT_ENTRY_NAMES.has(path.basename(__filename))
  ) {
    return undefined;
  }
  return require;
}

function isSlidesTypeScriptRuntime(value: unknown): value is SlidesTypeScriptRuntime {
  if (!value || typeof value !== 'object') return false;
  return (
    typeof Reflect.get(value, 'createSourceFile') === 'function' &&
    typeof Reflect.get(value, 'createProgram') === 'function' &&
    typeof Reflect.get(value, 'createCompilerHost') === 'function' &&
    typeof Reflect.get(value, 'flattenDiagnosticMessageText') === 'function' &&
    typeof Reflect.get(value, 'transpileModule') === 'function' &&
    typeof Reflect.get(value, 'sys') === 'object' &&
    typeof Reflect.get(value, 'ScriptTarget') === 'object' &&
    typeof Reflect.get(value, 'DiagnosticCategory') === 'object'
  );
}
