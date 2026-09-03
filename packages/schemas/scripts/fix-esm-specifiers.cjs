/* eslint-disable no-console */
/**
 * 中文说明：
 * - `tsc` 直接输出的 ESM（module=ES2020）会保留 `export * from './x'` 这种“无扩展名”相对路径；
 * - Node ESM 默认不接受无扩展名的相对 specifier，会在运行时抛出 ERR_MODULE_NOT_FOUND；
 * - 该脚本在 `dist/esm` 下做一次后处理，把相对路径补成 Node ESM 可解析的入口；
 * - 如果 specifier 指向目录 barrel（如 `./plugins`），应解析为 `./plugins/index.js`，
 *   不能机械写成 `./plugins.js`。
 *
 * 约束：
 * - 只处理以 `./` 或 `../` 开头的 specifier
 * - 已经是 `.js/.mjs/.cjs/.json` 的不改
 */

const fs = require('fs');
const path = require('path');

const ESM_DIR = path.join(__dirname, '..', 'dist', 'esm');

/**
 * @param {string} spec
 */
function shouldAppendJs(spec) {
  if (!(spec.startsWith('./') || spec.startsWith('../'))) return false;
  if (spec.endsWith('.js') || spec.endsWith('.mjs') || spec.endsWith('.cjs') || spec.endsWith('.json')) return false;
  return true;
}

/**
 * @param {string} file
 * @param {string} spec
 */
function resolveEsmSpecifier(file, spec) {
  if (!shouldAppendJs(spec)) return spec;

  const fromDir = path.dirname(file);
  const absBase = path.resolve(fromDir, spec);
  if (fs.existsSync(`${absBase}.js`)) {
    return `${spec}.js`;
  }
  if (fs.existsSync(path.join(absBase, 'index.js'))) {
    return `${spec}/index.js`;
  }

  return `${spec}.js`;
}

/**
 * @param {string} file
 * @param {string} content
 */
function rewriteRelativeSpecifiers(file, content) {
  // 处理 `from '...'` / `from "..."` 的场景
  const FROM_RE = /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g;
  // 处理 `export * from '...'` 的场景（上面也能覆盖，但这里单独保底）
  const EXPORT_STAR_RE = /(export\s+\*\s+from\s+['"])(\.\.?\/[^'"]+)(['"])/g;

  const replacer = (_m, p1, spec, p3) => `${p1}${resolveEsmSpecifier(file, spec)}${p3}`;

  return content.replace(EXPORT_STAR_RE, replacer).replace(FROM_RE, replacer);
}

/**
 * @param {string} dir
 */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile() && abs.endsWith('.js')) out.push(abs);
  }
  return out;
}

function main() {
  if (!fs.existsSync(ESM_DIR)) {
    console.warn(`[schemas] skip fix-esm-specifiers: ${ESM_DIR} 不存在`);
    return;
  }

  const files = walk(ESM_DIR);
  let touched = 0;

  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');
    const after = rewriteRelativeSpecifiers(file, before);
    if (after !== before) {
      fs.writeFileSync(file, after, 'utf8');
      touched += 1;
    }
  }

  console.log(`[schemas] fixed ESM specifiers in ${touched}/${files.length} files`);
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveEsmSpecifier,
  rewriteRelativeSpecifiers,
  shouldAppendJs,
};
