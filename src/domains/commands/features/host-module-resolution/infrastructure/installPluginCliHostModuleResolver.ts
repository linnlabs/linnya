import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

type CommonJsLoad = (
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
) => unknown;

type CommonJsResolveFilename = (
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
  options?: { readonly paths?: readonly string[] },
) => string;

const pluginCliHostModuleSpecifiers = new Set([
  '@node-rs/jieba',
  'better-sqlite3',
  'harfbuzzjs',
  'pdfjs-dist',
  'pdfjs-dist/legacy/build/pdf',
  'sharp',
  'yoga-layout',
  'yoga-layout/load',
]);

function isCommonJsLoad(value: unknown): value is CommonJsLoad {
  return typeof value === 'function';
}

function readRawCommonJsLoad(): CommonJsLoad {
  const load = Reflect.get(Module, '_load');
  if (!isCommonJsLoad(load)) {
    throw new Error('[command-host] Node Module._load is not available.');
  }
  return load;
}

function isCommonJsResolveFilename(value: unknown): value is CommonJsResolveFilename {
  return typeof value === 'function';
}

function readRawCommonJsResolveFilename(): CommonJsResolveFilename {
  const resolveFilename = Reflect.get(Module, '_resolveFilename');
  if (!isCommonJsResolveFilename(resolveFilename)) {
    throw new Error('[command-host] Node Module._resolveFilename is not available.');
  }
  return resolveFilename;
}

function callCommonJsLoad(
  load: CommonJsLoad,
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
): unknown {
  return Reflect.apply(load, Module, [request, parent, isMain]);
}

function callCommonJsResolveFilename(
  resolveFilename: CommonJsResolveFilename,
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
  options?: { readonly paths?: readonly string[] },
): string {
  return Reflect.apply(resolveFilename, Module, [request, parent, isMain, options]);
}

function normalizeExistingPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, filePath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isPluginCliParent(
  parent: NodeModule | null | undefined,
  pluginCliDirectory: string,
): boolean {
  if (!parent?.filename) return false;
  return isInsideDirectory(normalizeExistingPath(parent.filename), pluginCliDirectory);
}

/**
 * 为插件 CLI artifact 提供打包后仍可用的重型运行时依赖。
 *
 * CLI 位于 Resources/plugins，不能直接看见 app.asar/node_modules。这里的解析器只接管
 * 固定依赖白名单，并且只服务当前插件 CLI 目录内的父模块；模型参数和插件 manifest
 * 都无法扩大可加载模块范围。Plugin CLI mode 是独占短进程，解析器保持到进程退出。
 */
export function installPluginCliHostModuleResolver(input: {
  readonly pluginCliDirectory: string;
  readonly hostAppRoot: string;
}): () => void {
  const pluginCliDirectory = normalizeExistingPath(input.pluginCliDirectory);
  const requireFromHost = createRequire(path.join(input.hostAppRoot, 'package.json'));
  const originalLoad = readRawCommonJsLoad();
  const originalResolveFilename = readRawCommonJsResolveFilename();
  const scopedLoad: CommonJsLoad = (request, parent, isMain) => {
    if (
      pluginCliHostModuleSpecifiers.has(request)
      && isPluginCliParent(parent, pluginCliDirectory)
    ) {
      return requireFromHost(request);
    }
    return callCommonJsLoad(originalLoad, request, parent, isMain);
  };
  const scopedResolveFilename: CommonJsResolveFilename = (request, parent, isMain, options) => {
    if (
      pluginCliHostModuleSpecifiers.has(request)
      && isPluginCliParent(parent, pluginCliDirectory)
    ) {
      return requireFromHost.resolve(request);
    }
    return callCommonJsResolveFilename(originalResolveFilename, request, parent, isMain, options);
  };

  Reflect.set(Module, '_load', scopedLoad);
  Reflect.set(Module, '_resolveFilename', scopedResolveFilename);
  return () => {
    if (Reflect.get(Module, '_load') === scopedLoad) {
      Reflect.set(Module, '_load', originalLoad);
    }
    if (Reflect.get(Module, '_resolveFilename') === scopedResolveFilename) {
      Reflect.set(Module, '_resolveFilename', originalResolveFilename);
    }
  };
}
