import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOTS = ['src', 'packages', 'docs'];
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2']);

const violations = [];

for (const root of ROOTS) {
  scan(root);
}

if (violations.length > 0) {
  console.error('[no-font-binary-fixtures] Font binaries must not be committed under src/packages/docs:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

function scan(path) {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      scan(entryPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const fileStat = statSync(entryPath);
    if (fileStat.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      violations.push(entryPath);
    }
  }
}
