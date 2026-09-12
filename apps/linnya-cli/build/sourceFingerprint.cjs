const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

/** 开发 launcher 与构建器共用内容指纹；mtime 和 package version 都不能证明产物新鲜度。 */
function createCliSourceFingerprint(cliRoot) {
  const repoRoot = path.resolve(cliRoot, '../..');
  const inputs = [
    'pnpm-lock.yaml',
    'apps/linnya-cli/package.json',
    'apps/linnya-cli/tsconfig.json',
    'apps/linnya-cli/tsup.config.ts',
    'apps/linnya-cli/bin/linnya.cjs',
    'apps/linnya-cli/build/sourceFingerprint.cjs',
  ];
  function collect(directory) {
    for (const entry of readdirSync(path.join(repoRoot, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('__') || /\.(test|spec)\./u.test(entry.name)) continue;
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) collect(relative);
      else if (entry.isFile()) inputs.push(relative);
    }
  }
  collect('apps/linnya-cli/src');
  // CLI 静态内联公共 Schema，指纹必须覆盖这份源码，而不能只检查 CLI 自身。
  collect('packages/schemas/src');
  const hash = createHash('sha256');
  for (const input of inputs.sort()) {
    const bytes = readFileSync(path.join(repoRoot, input));
    hash.update(`${input}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

module.exports = { createCliSourceFingerprint };
