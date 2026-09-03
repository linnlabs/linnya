import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const rendererDir = path.join(rootDir, 'apps/renderer');
const rendererUiStylesDir = path.join(rootDir, 'packages/renderer-ui/src/styles');
const strict = process.argv.includes('--strict');

const sourceExtensions = new Set(['.vue', '.css', '.ts', '.js']);
const styleExtensions = new Set(['.vue', '.css']);
const excludedSegments = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}dist_build${path.sep}`,
  `${path.sep}apps${path.sep}renderer${path.sep}domains${path.sep}sheet${path.sep}react-ref${path.sep}univer${path.sep}`,
];

const rawColorAllowedFiles = new Set([
  normalizePath('packages/renderer-ui/src/styles/tokens/foundation.css'),
  normalizePath('packages/renderer-ui/src/styles/tokens/semantic.css'),
  normalizePath('apps/renderer/domains/conversation/styles/theme-tokens.css'),
  normalizePath('apps/renderer/domains/editor/styles/tokens/theme.css'),
  normalizePath('apps/renderer/domains/editor/styles/tokens/block-colors.css'),
  normalizePath('apps/renderer/domains/editor/styles/tokens/syntax-highlight.css'),
]);

const darkModeAllowedFiles = new Set([
  normalizePath('apps/renderer/domains/editor/styles/tokens/block-colors.css'),
  normalizePath('apps/renderer/domains/editor/styles/tokens/syntax-highlight.css'),
]);

const legacyTokenNames = [
  '--text-color',
  '--text-color-primary',
  '--text-color-secondary',
  '--text-color-dark',
  '--text-secondary',
  '--text-secondary-dark',
  '--text-tertiary',
  '--text-muted',
  '--text-muted-dark',
  '--text-hint',
  '--placeholder-color',
  '--color-text-hint',
  '--color-header-text',
  '--bg-color',
  '--bg-color-dark',
  '--content-bg-color',
  '--menu-bg-color',
  '--menu-hover-color',
  '--status-bar-bg-color',
  '--bg-light',
  '--bg-dark',
  '--color-background-default',
  '--color-background-surface',
  '--color-background-sidebar',
  '--color-background-subtle',
  '--color-background-disabled',
  '--color-background-search',
  '--color-background-search-light',
  '--color-background-selection',
  '--border-color',
  '--border-light',
  '--border-gray',
  '--border-hover-color',
  '--color-border-primary-light',
  '--primary-color',
  '--primary-color-light',
  '--primary-color-very-light',
  '--primary-color-light-hover',
  '--secondary-color',
  '--color-accent-primary',
  '--color-accent-primary-hover',
  '--color-accent-primary-hover-light',
  '--color-accent-primary-rgb',
  '--color-accent-primary-secondary',
  '--color-accent-primary-light',
  '--color-accent-primary-very-light',
  '--color-accent-primary-disabled',
  '--color-accent-background',
  '--color-accent-background-light',
  '--color-accent-background-hover',
  '--hover-color',
  '--hover-color-dark',
  '--active-color',
  '--focus-color',
  '--color-interactive-surface-hover',
  '--color-interactive-surface-hover-light',
  '--color-interactive-surface-hover-darker',
  '--color-interactive-surface-active',
  '--color-interactive-handle-hover',
  '--link-color',
  '--link-hover-color',
  '--color-shadow-extra-light',
  '--color-shadow-light',
  '--color-shadow-default',
  '--color-shadow-medium',
  '--color-shadow-strong',
  '--color-button-primary-background',
  '--color-button-primary-background-hover',
  '--color-button-primary-background-active',
  '--color-button-primary-text',
  '--color-button-primary-border',
  '--color-button-secondary-background',
  '--color-button-secondary-background-hover',
  '--color-button-secondary-background-active',
  '--color-button-secondary-text',
  '--color-button-secondary-text-hover',
  '--color-button-secondary-border',
  '--color-button-secondary-border-hover',
  '--h1-color',
  '--h2-color',
  '--h3-color',
  '--h4-h5-h6-color',
  '--success-color',
  '--error-color',
  '--danger-color',
  '--warning-color',
  '--info-color',
  '--success-bg-color',
  '--error-bg-color',
  '--warning-bg-color',
  '--warning-bg-color-light',
  '--warning-bg-color-darker',
  '--info-bg-color',
  '--info-bg-color-light',
  '--info-bg-color-dark',
  '--success-color-light',
  '--error-color-light',
  '--warning-color-light',
  '--info-color-light',
  '--success-hover-color',
  '--error-hover-color',
  '--warning-hover-color',
  '--info-hover-color',
  '--success-button-bg',
  '--success-button-hover',
  '--success-button-active',
  '--success-button-text-color',
  '--error-button-bg',
  '--error-button-hover',
  '--error-button-active',
  '--error-button-text-color',
  '--warning-button-bg',
  '--warning-button-hover',
  '--warning-button-active',
  '--warning-button-text-color',
  '--info-button-bg',
  '--info-button-hover',
  '--info-button-active',
  '--info-button-text-color',
  '--highlight-keyword',
  '--highlight-function',
  '--highlight-variable',
  '--highlight-string',
  '--highlight-builtin',
  '--highlight-tag',
  '--highlight-attribute',
  '--highlight-comment',
];

const legacyTokens = new Set(legacyTokenNames);

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativePath(filePath) {
  return normalizePath(path.relative(rootDir, filePath));
}

function isExcluded(filePath) {
  const absolute = path.resolve(filePath);
  return excludedSegments.some((segment) => absolute.includes(segment));
}

async function walk(dir) {
  const entries = await readdir(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    if (isExcluded(fullPath)) {
      continue;
    }

    const entryStat = await stat(fullPath);
    if (entryStat.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }

    if (sourceExtensions.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractVueStyleBlocks(content) {
  const blocks = [];
  const styleBlockPattern = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;

  for (const match of content.matchAll(styleBlockPattern)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const before = content.slice(0, match.index);
    const startLine = before.split(/\r?\n/).length;

    blocks.push({
      attrs,
      body,
      isScoped: /\bscoped\b/i.test(attrs),
      isSrc: /\bsrc\s*=/i.test(attrs),
      startLine,
    });
  }

  return blocks;
}

function countMeaningfulLines(text) {
  return text
    .replace(/^\s+|\s+$/g, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function collectCustomPropertyDefinitions(text, definitions) {
  for (const match of text.matchAll(/(?:^|[;\s{])(--[A-Za-z0-9_-]+)\s*:/g)) {
    definitions.add(match[1]);
  }

  for (const match of text.matchAll(/['"](--[A-Za-z0-9_-]+)['"]\s*:/g)) {
    definitions.add(match[1]);
  }
}

function collectVarReferences(text, file, refs) {
  for (const match of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    refs.push({
      token: match[1],
      file,
      line: lineNumberAt(text, match.index ?? 0),
    });
  }
}

function collectLegacyTokenHits(text, file, hits) {
  for (const token of legacyTokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'g');
    for (const match of text.matchAll(pattern)) {
      hits.push({
        token,
        file,
        line: lineNumberAt(text, match.index ?? 0),
      });
    }
  }
}

function collectRawColorHits(text, file, hits) {
  const rel = relativePath(file);
  if (rawColorAllowedFiles.has(rel)) {
    return;
  }

  const colorPattern = /#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*[^)]+?\)/g;
  for (const match of text.matchAll(colorPattern)) {
    hits.push({
      value: match[0],
      file,
      line: lineNumberAt(text, match.index ?? 0),
    });
  }
}

function collectDarkModeHits(text, file, hits) {
  const rel = relativePath(file);
  if (darkModeAllowedFiles.has(rel)) {
    return;
  }

  for (const match of text.matchAll(/\.dark-mode\b/g)) {
    hits.push({
      file,
      line: lineNumberAt(text, match.index ?? 0),
    });
  }
}

function printTop(title, items, formatItem, limit = 20) {
  console.log(`\n${title}: ${items.length}`);
  if (items.length === 0) {
    return;
  }

  for (const item of items.slice(0, limit)) {
    console.log(`  - ${formatItem(item)}`);
  }

  if (items.length > limit) {
    console.log(`  ... 另有 ${items.length - limit} 条`);
  }
}

function groupByFile(items) {
  const groups = new Map();
  for (const item of items) {
    const file = relativePath(item.file);
    groups.set(file, (groups.get(file) ?? 0) + 1);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file, count]) => ({ file, count }));
}

/*
 * Renderer UI 是 Host token 的正式上游 owner。这里把 package CSS 纳入定义闭包，
 * 但 package 自身更严格的 selector/theme/import 规则仍由 package-local style-audit 负责。
 */
const files = [
  ...await walk(rendererDir),
  ...await walk(rendererUiStylesDir),
];
const definitions = new Set();
const refs = [];
const legacyHits = [];
const rawColorHits = [];
const darkModeHits = [];
const scopedDarkModeHits = [];
const oversizedScopedStyles = [];
const vueStyleBlocks = [];

for (const file of files) {
  const ext = path.extname(file);
  const text = await readFile(file, 'utf8');

  collectCustomPropertyDefinitions(text, definitions);
  collectVarReferences(text, file, refs);
  collectLegacyTokenHits(text, file, legacyHits);

  if (styleExtensions.has(ext)) {
    collectRawColorHits(text, file, rawColorHits);
    collectDarkModeHits(text, file, darkModeHits);
  }

  if (ext !== '.vue') {
    continue;
  }

  for (const block of extractVueStyleBlocks(text)) {
    vueStyleBlocks.push({
      file,
      line: block.startLine,
      isScoped: block.isScoped,
      isSrc: block.isSrc,
    });

    if (!block.isScoped || block.isSrc) {
      continue;
    }

    const lineCount = countMeaningfulLines(block.body);
    if (lineCount > 60) {
      oversizedScopedStyles.push({
        file,
        line: block.startLine,
        lineCount,
      });
    }

    for (const match of block.body.matchAll(/\.dark-mode\b/g)) {
      scopedDarkModeHits.push({
        file,
        line: block.startLine + lineNumberAt(block.body, match.index ?? 0) - 1,
      });
    }
  }
}

const undefinedVarRefs = refs.filter((ref) => !definitions.has(ref.token));

console.log('Linnya 样式系统审计 baseline');
console.log('================================');
console.log(`扫描文件数: ${files.length}`);
console.log(`已定义 CSS 变量数: ${definitions.size}`);
console.log(`CSS var() 引用数: ${refs.length}`);

printTop(
  'Vue SFC style 块',
  vueStyleBlocks,
  (item) => {
    const attrs = [
      item.isScoped ? 'scoped' : null,
      item.isSrc ? 'src' : null,
    ].filter(Boolean).join(', ');
    return `${relativePath(item.file)}:${item.line}${attrs ? ` (${attrs})` : ''}`;
  },
);

printTop(
  'scoped style 超过 60 行',
  oversizedScopedStyles.sort((a, b) => b.lineCount - a.lineCount),
  (item) => `${relativePath(item.file)}:${item.line} (${item.lineCount} 行)`,
);

printTop(
  'scoped style 内 .dark-mode 命中',
  scopedDarkModeHits,
  (item) => `${relativePath(item.file)}:${item.line}`,
);

printTop(
  '非白名单 .dark-mode 命中',
  darkModeHits,
  (item) => `${relativePath(item.file)}:${item.line}`,
);

printTop(
  '旧 token 名称命中',
  legacyHits,
  (item) => `${relativePath(item.file)}:${item.line} ${item.token}`,
);

printTop(
  '未定义 CSS 变量引用',
  undefinedVarRefs,
  (item) => `${relativePath(item.file)}:${item.line} ${item.token}`,
);

printTop(
  '硬编码颜色命中文件 Top',
  groupByFile(rawColorHits),
  (item) => `${item.file} (${item.count} 处)`,
);

console.log(`\n硬编码颜色总命中: ${rawColorHits.length}`);

const issueCount =
  vueStyleBlocks.length +
  oversizedScopedStyles.length +
  scopedDarkModeHits.length +
  darkModeHits.length +
  legacyHits.length +
  undefinedVarRefs.length +
  rawColorHits.length;

const issueCountLabel = strict
  ? '当前为 strict gate，总问题计数'
  : '当前 baseline 总问题计数';

console.log(`\n${issueCountLabel}: ${issueCount}`);

if (strict && issueCount > 0) {
  process.exitCode = 1;
}
