import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src');

const FORBIDDEN_IMPORTS = [
  'presentationToolView.js',
  'presentationGeneratedEditState.js',
  'presentationEditInput.js',
  'presentationEditEngine.js',
];

function listTypeScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(absolute));
      continue;
    }
    if (entry.isFile() && absolute.endsWith('.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

describe('AI PPT tooling import structure', () => {
  it('does not import retired root tooling facades', () => {
    const files = listTypeScriptFiles(ROOT);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(
          source,
          `${file} should not import ${forbidden}`,
        ).not.toMatch(new RegExp(`from ['"][^'"]*${forbidden.replace('.', '\\.') }['"]`));
      }
    }
  });
});
