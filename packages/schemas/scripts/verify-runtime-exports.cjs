/* eslint-disable no-console */
/**
 * 验证公开入口能被 Node 按真实 package exports 解析。
 *
 * TypeScript 可以通过 monorepo path alias 直接找到源码，因此仅做类型检查无法发现
 * package.json 漏配子入口的问题。这里同时加载 CommonJS 与 ESM 入口，让这类错误在
 * schemas 构建阶段失败，而不是等到 Electron 启动时才暴露。
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const packageManifest = require('../package.json');

const PACKAGE_NAME = packageManifest.name;
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const SOURCE_ROOT_NAMES = ['apps', 'src', 'packages', 'scripts', 'tests'];
const REQUIRED_EXPORT_CONDITIONS = ['types', 'import', 'require', 'default'];
const SOURCE_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
]);

function toPackageSpecifier(subpath) {
  return subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.slice(2)}`;
}

function toPackageSubpath(specifier) {
  return specifier === PACKAGE_NAME ? '.' : `.${specifier.slice(PACKAGE_NAME.length)}`;
}

function collectSourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

function collectScriptModuleSpecifiers(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const specifiers = new Set();

  function addStringLiteral(node) {
    if (
      node &&
      ts.isStringLiteralLike(node) &&
      (node.text === PACKAGE_NAME || node.text.startsWith(`${PACKAGE_NAME}/`))
    ) {
      specifiers.add(node.text);
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        addStringLiteral(node.moduleReference.expression);
      }
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequireCall || isDynamicImport) addStringLiteral(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addStringLiteral(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function collectRequiredPackageSubpaths() {
  const specifiers = new Set([PACKAGE_NAME]);
  const sourceFiles = SOURCE_ROOT_NAMES.flatMap(rootName =>
    collectSourceFiles(path.join(REPOSITORY_ROOT, rootName)),
  );

  for (const fileName of sourceFiles) {
    const sourceText = fs.readFileSync(fileName, 'utf8');
    if (!sourceText.includes(PACKAGE_NAME)) continue;

    if (fileName.endsWith('.vue')) {
      const scriptBlockPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      for (const match of sourceText.matchAll(scriptBlockPattern)) {
        for (const specifier of collectScriptModuleSpecifiers(match[1], fileName)) {
          specifiers.add(specifier);
        }
      }
      continue;
    }

    for (const specifier of collectScriptModuleSpecifiers(sourceText, fileName)) {
      specifiers.add(specifier);
    }
  }

  return new Set([...specifiers].map(toPackageSubpath));
}

function assertExportTargetsExist(subpath, conditions) {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
    throw new Error(`[schemas] 公开入口缺少条件映射: ${subpath}`);
  }

  for (const condition of REQUIRED_EXPORT_CONDITIONS) {
    const target = conditions[condition];
    if (typeof target !== 'string' || !target.startsWith('./')) {
      throw new Error(`[schemas] 公开入口 ${subpath} 缺少 ${condition} 目标`);
    }
    if (!fs.existsSync(path.resolve(PACKAGE_ROOT, target))) {
      throw new Error(`[schemas] 公开入口 ${subpath} 的 ${condition} 产物不存在: ${target}`);
    }
  }
}

async function main() {
  const publicExports = packageManifest.exports;
  const requiredSubpaths = collectRequiredPackageSubpaths();
  const missingSubpaths = [...requiredSubpaths].filter(
    subpath => !Object.prototype.hasOwnProperty.call(publicExports, subpath),
  );

  if (missingSubpaths.length > 0) {
    throw new Error(`[schemas] 业务代码使用了未公开的子入口: ${missingSubpaths.join(', ')}`);
  }

  for (const [subpath, conditions] of Object.entries(publicExports)) {
    assertExportTargetsExist(subpath, conditions);
    const specifier = toPackageSpecifier(subpath);
    require(specifier);
    await import(specifier);
  }

  console.log(
    `[schemas] verified ${Object.keys(publicExports).length} runtime exports ` +
      `(types + CommonJS + ESM), ${requiredSubpaths.size} source subpaths covered`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
