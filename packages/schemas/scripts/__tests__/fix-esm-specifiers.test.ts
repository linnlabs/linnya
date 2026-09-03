import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  rewriteRelativeSpecifiers,
} = require('../fix-esm-specifiers.cjs') as {
  rewriteRelativeSpecifiers(file: string, content: string): string;
};

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schemas-esm-specifiers-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('fix-esm-specifiers', () => {
  it('rewrites directory barrel specifiers to index.js', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'api-dtos.js'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'plugins', 'index.js'), '', 'utf8');

    const rewritten = rewriteRelativeSpecifiers(
      path.join(dir, 'index.js'),
      [
        "export * from './api-dtos';",
        "export * from './plugins';",
      ].join('\n'),
    );

    expect(rewritten).toContain("export * from './api-dtos.js';");
    expect(rewritten).toContain("export * from './plugins/index.js';");
  });

  it('preserves already resolved and package specifiers', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'index.js'), '', 'utf8');

    const rewritten = rewriteRelativeSpecifiers(
      path.join(dir, 'index.js'),
      [
        "import z from 'zod';",
        "export * from './citation.js';",
      ].join('\n'),
    );

    expect(rewritten).toContain("import z from 'zod';");
    expect(rewritten).toContain("export * from './citation.js';");
  });
});
