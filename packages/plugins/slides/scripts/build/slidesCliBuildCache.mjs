import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// CLI 同时打包插件、SDK 和宿主适配器；只看 slides/src 会漏掉宿主依赖变更。
const INPUT_ROOTS = ['src', 'packages', 'scripts', 'config', 'apps/renderer'];
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.cache', 'coverage']);
const BUILD_OUTPUTS = ['dist/cli', 'dist/raster-worker', 'dist/backend/raster-worker-preload.cjs'];

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) files.push(...await filesUnder(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

export async function slidesCliInputHash(repoRoot) {
  const hash = createHash('sha256').update(process.version).update(process.platform).update(process.arch);
  const rootFiles = (await readdir(repoRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(json|yaml|yml|m?[jt]s)$/.test(entry.name))
    .map(entry => path.join(repoRoot, entry.name));
  const sourceFiles = (await Promise.all(INPUT_ROOTS.map(root => filesUnder(path.join(repoRoot, root))))).flat();
  for (const file of [...rootFiles, ...sourceFiles].sort()) {
    hash.update(path.relative(repoRoot, file));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

async function outputFingerprint(packageRoot) {
  const files = [];
  for (const output of BUILD_OUTPUTS) {
    const absolute = path.join(packageRoot, output);
    const info = await stat(absolute);
    files.push(...info.isDirectory() ? await filesUnder(absolute) : [absolute]);
  }
  if (files.length < BUILD_OUTPUTS.length) throw new Error('Slides CLI build outputs are incomplete');
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(path.relative(packageRoot, file));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

export async function hasCurrentSlidesCliBuild(packageRoot, inputHash) {
  try {
    const cached = JSON.parse(await readFile(path.join(packageRoot, 'dist/cli-build-cache.json'), 'utf8'));
    return cached.inputHash === inputHash && cached.outputHash === await outputFingerprint(packageRoot);
  } catch {
    // 缓存或产物缺失/损坏意味着需要真实重建，不是运行时兜底。
    return false;
  }
}

export async function recordSlidesCliBuild(packageRoot, inputHash) {
  const outputHash = await outputFingerprint(packageRoot);
  await writeFile(path.join(packageRoot, 'dist/cli-build-cache.json'), JSON.stringify({ inputHash, outputHash }));
}
