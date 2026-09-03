import { strict as assert } from 'node:assert';
import console from 'node:console';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const packageRoot = process.cwd();
const packageSourceRoot = path.join(packageRoot, 'src');
const packageManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const packageRequire = createRequire(path.join(packageRoot, 'package.json'));
const builtInThemes = ['light', 'dark', 'moon-blue'];
const cssFiles = collectCssFiles(packageSourceRoot);
const tokenDefinitions = new Set();
const tokenReferences = new Set();
const themeTokens = new Map(builtInThemes.map(theme => [theme, new Set()]));

assert.ok(cssFiles.length > 0, 'Renderer UI 至少要有一个 CSS 公开入口');

for (const filePath of cssFiles) {
  const source = readFileSync(filePath, 'utf8');
  const relativePath = normalizePath(path.relative(packageRoot, filePath));

  verifyImports(relativePath, filePath, source);
  verifyUrls(relativePath, filePath, source);
  verifyGlobalSelectors(relativePath, source);
  collectTokens(source, tokenDefinitions, tokenReferences);
  collectThemeTokens(relativePath, source);
}

const undefinedTokens = [...tokenReferences]
  .filter(token => !tokenDefinitions.has(token))
  .sort();
assert.deepEqual(undefinedTokens, [], `Renderer UI CSS 引用了未定义 token：${undefinedTokens.join(', ')}`);

const nonEmptyThemeTokenSets = [...themeTokens.values()].filter(tokens => tokens.size > 0);
if (nonEmptyThemeTokenSets.length > 0) {
  assert.equal(nonEmptyThemeTokenSets.length, builtInThemes.length, '三个内置主题必须同时提供 token 映射');
  const expectedTokens = [...themeTokens.get(builtInThemes[0])].sort();
  for (const theme of builtInThemes.slice(1)) {
    assert.deepEqual(
      [...themeTokens.get(theme)].sort(),
      expectedTokens,
      `内置主题 ${theme} 的 token 集合不完整`,
    );
  }
}

console.log(`Renderer UI style contract 通过（${cssFiles.length} CSS，${tokenDefinitions.size} definitions，${tokenReferences.size} references）。`);

function collectCssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectCssFiles(entryPath);
      return entry.name.endsWith('.css') ? [entryPath] : [];
    })
    .sort();
}

function verifyImports(relativePath, filePath, source) {
  for (const match of source.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]\s*\)?[^;]*;/gu)) {
    const specifier = match[1];
    if (specifier.startsWith('.')) {
      const resolvedPath = path.resolve(path.dirname(filePath), specifier);
      assert.ok(
        resolvedPath.startsWith(`${packageSourceRoot}${path.sep}`) && existsSync(resolvedPath),
        `${relativePath} 的相对 @import 不在 package source 闭包内：${specifier}`,
      );
      continue;
    }

    const dependencyName = readDependencyName(specifier);
    assert.ok(
      Object.hasOwn(packageManifest.dependencies ?? {}, dependencyName),
      `${relativePath} 的第三方 @import 未声明 runtime dependency：${specifier}`,
    );
    assert.doesNotThrow(
      () => packageRequire.resolve(specifier),
      undefined,
      `${relativePath} 的第三方 @import 无法从 package 解析：${specifier}`,
    );
  }
}

function verifyUrls(relativePath, filePath, source) {
  for (const match of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gu)) {
    const specifier = match[1];
    if (specifier.startsWith('data:') || specifier.startsWith('#')) continue;
    assert.ok(
      specifier.startsWith('.') && existsSync(path.resolve(path.dirname(filePath), specifier)),
      `${relativePath} 的 url(...) 资产不在 package 文件闭包内：${specifier}`,
    );
  }
}

function verifyGlobalSelectors(relativePath, source) {
  assert.ok(!source.includes('.dark-mode'), `${relativePath} 不得继续定义 .dark-mode`);
  assert.ok(!source.includes('.moon-blue-mode'), `${relativePath} 不得继续定义 .moon-blue-mode`);

  const selectors = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .matchAll(/(?:^|\})\s*([^@}\n][^{]+)\{/gmu);
  for (const match of selectors) {
    const selectorList = match[1].split(',').map(selector => selector.trim());
    for (const selector of selectorList) {
      assert.ok(
        !/^(?:\*|html|body|button|input|select|textarea)(?:$|::?|\[|\s|>)/u.test(selector),
        `${relativePath} 不得包含 package 无 owner 的全局 selector：${selector}`,
      );
    }
  }
}

function collectTokens(source, definitions, references) {
  for (const match of source.matchAll(/(--[a-z][a-z0-9-]*)\s*:/giu)) definitions.add(match[1]);
  for (const match of source.matchAll(/var\(\s*(--[a-z][a-z0-9-]*)/giu)) references.add(match[1]);
}

function collectThemeTokens(relativePath, source) {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of source.matchAll(rulePattern)) {
    const selector = match[1];
    const declarationBlock = match[2];
    for (const themeMatch of selector.matchAll(/\[data-linnya-ui-theme=['"]([^'"]+)['"]\]/gu)) {
      const theme = themeMatch[1];
      assert.ok(themeTokens.has(theme), `${relativePath} 声明了未登记内置主题：${theme}`);
      for (const tokenMatch of declarationBlock.matchAll(/(--[a-z][a-z0-9-]*)\s*:/giu)) {
        themeTokens.get(theme).add(tokenMatch[1]);
      }
    }
  }
}

function readDependencyName(specifier) {
  if (!specifier.startsWith('@')) return specifier.split('/')[0];
  return specifier.split('/').slice(0, 2).join('/');
}

function normalizePath(value) {
  return value.replaceAll(path.sep, '/');
}
