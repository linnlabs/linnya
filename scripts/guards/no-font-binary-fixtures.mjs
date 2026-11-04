import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';

const ROOTS = ['src', 'packages', 'docs'];
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2']);

// 检查已跟踪文件与未忽略的新源码；构建从依赖复制的字体不是源码fixture。
// 被force-add的产物仍在cached清单里，不能借dist/gitignore绕过公开源码边界。
const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...ROOTS], { encoding: 'utf8' });
const violations = candidates.split('\0').filter(file => file && FONT_EXTENSIONS.has(extname(file).toLowerCase()));

if (violations.length > 0) {
  console.error('[no-font-binary-fixtures] Font binaries must not be committed under src/packages/docs:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}
