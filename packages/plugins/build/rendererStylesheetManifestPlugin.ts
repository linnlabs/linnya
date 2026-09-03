import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  parsePluginRendererStylesheetManifest,
} from '../../schemas/src/plugins/renderer-stylesheet-manifest';
import type { OutputAsset, Plugin } from 'vite';

const stylesheetManifestFileName = 'renderer-stylesheets.json';
const cssUrlImportPattern = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.css)\?url['"]\s*;/gu;

export interface RendererStylesheetManifestPluginOptions {
  readonly entryPath: string;
}

interface StylesheetUrlImport {
  readonly identifier: string;
  readonly sourcePath: string;
}

/**
 * 从 renderer contribution 的 stylesheets 数组读取唯一声明顺序。
 * 构建配置不再维护第二份文件名清单，避免 source 与 artifact 顺序漂移。
 */
export function readRendererStylesheetSourceOrder(entryPath: string): readonly string[] {
  const source = fs.readFileSync(entryPath, 'utf8');
  const imports = readStylesheetUrlImports(entryPath, source);
  const declaration = readStylesheetDeclaration(source);
  const identifiers = readArrayIdentifiers(declaration);
  const sourceByIdentifier = new Map(imports.map(item => [item.identifier, item.sourcePath]));
  const orderedSources = identifiers.map(identifier => {
    const sourcePath = sourceByIdentifier.get(identifier);
    if (!sourcePath) {
      throw new Error(`renderer stylesheets 使用了未通过 CSS ?url import 声明的标识符：${identifier}`);
    }
    return sourcePath;
  });

  if (new Set(orderedSources).size !== orderedSources.length) {
    throw new Error('renderer stylesheets 不得重复声明同一个 CSS source');
  }
  const unusedImports = imports.filter(item => !identifiers.includes(item.identifier));
  if (unusedImports.length > 0) {
    throw new Error(`CSS ?url import 未进入 renderer stylesheets：${unusedImports.map(item => item.identifier).join(', ')}`);
  }
  return orderedSources;
}

export function rendererStylesheetManifestPlugin(
  options: RendererStylesheetManifestPluginOptions,
): Plugin {
  const orderedSources = readRendererStylesheetSourceOrder(options.entryPath);

  return {
    name: 'linnya-renderer-stylesheet-manifest',
    generateBundle(_outputOptions, bundle) {
      const outputBySource = new Map<string, string>();
      const cssAssets = Object.values(bundle).filter(
        (item): item is OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'),
      );

      for (const asset of cssAssets) {
        const sourcePaths = asset.originalFileNames
          .filter(filePath => filePath.endsWith('.css'))
          .map(normalizeExistingPath);
        for (const sourcePath of sourcePaths) {
          if (outputBySource.has(sourcePath)) {
            throw new Error(`同一个 CSS source 被输出多次：${sourcePath}`);
          }
          outputBySource.set(sourcePath, asset.fileName);
        }
      }

      const stylesheets = orderedSources.map(sourcePath => {
        const outputPath = outputBySource.get(sourcePath);
        if (!outputPath) {
          throw new Error(`renderer stylesheet 没有对应构建产物：${sourcePath}`);
        }
        return outputPath;
      });
      const unexpectedAssets = cssAssets
        .map(asset => asset.fileName)
        .filter(fileName => !stylesheets.includes(fileName));
      if (unexpectedAssets.length > 0) {
        throw new Error(`renderer 产生了 contribution 未声明的 CSS asset：${unexpectedAssets.join(', ')}`);
      }

      const manifest = parsePluginRendererStylesheetManifest({
        schemaVersion: 1,
        stylesheets,
      });
      this.emitFile({
        type: 'asset',
        fileName: stylesheetManifestFileName,
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

function readStylesheetUrlImports(entryPath: string, source: string): readonly StylesheetUrlImport[] {
  const requireFromEntry = createRequire(entryPath);
  return Array.from(source.matchAll(cssUrlImportPattern), match => {
    const identifier = match[1];
    const specifier = match[2];
    if (!identifier || !specifier) throw new Error(`无法读取 CSS ?url import：${entryPath}`);
    const sourcePath = specifier.startsWith('.')
      ? path.resolve(path.dirname(entryPath), specifier)
      : requireFromEntry.resolve(specifier);
    return { identifier, sourcePath: normalizeExistingPath(sourcePath) };
  });
}

function readStylesheetDeclaration(source: string): string {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|\s)\/\/.*$/gmu, '$1');
  const contributionMatch = withoutComments.match(
    /\bstylesheets\s*:\s*([A-Za-z_$][\w$]*|\[[\s\S]*?\])/u,
  );
  const declaration = contributionMatch?.[1];
  if (!declaration) throw new Error('renderer contribution 必须显式声明 stylesheets');
  if (declaration.startsWith('[')) return declaration;

  const escapedIdentifier = declaration.replace(/[$]/gu, '\\$&');
  const arrayMatch = withoutComments.match(
    new RegExp(`\\bconst\\s+${escapedIdentifier}\\s*=\\s*(\\[[\\s\\S]*?\\])\\s+as\\s+const`, 'u'),
  );
  if (!arrayMatch?.[1]) {
    throw new Error(`renderer stylesheets 标识符必须指向 const tuple：${declaration}`);
  }
  return arrayMatch[1];
}

function readArrayIdentifiers(declaration: string): readonly string[] {
  const body = declaration.slice(1, -1).trim();
  if (!body) return [];
  const identifiers = body.split(',').map(value => value.trim()).filter(Boolean);
  if (identifiers.some(identifier => !/^[A-Za-z_$][\w$]*$/u.test(identifier))) {
    throw new Error('renderer stylesheets 只允许按顺序列出 CSS ?url import 标识符');
  }
  return identifiers;
}

function normalizeExistingPath(filePath: string): string {
  return fs.realpathSync(filePath).replaceAll(path.sep, '/');
}
