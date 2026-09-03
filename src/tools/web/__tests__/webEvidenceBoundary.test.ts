import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'docs' && entry.name !== '__tests__') {
        files.push(...await collectTypeScriptFiles(fullPath));
      }
    } else if (entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Web → Evidence domain 边界', () => {
  it('禁止 Web 穿透 Evidence domain 内部实现', async () => {
    const webRoot = path.resolve(process.cwd(), 'src/tools/web');
    const files = await collectTypeScriptFiles(webRoot);
    const violations: string[] = [];
    const forbiddenImports = [
      'knowledgebase/evidence/' + 'evidenceStore',
      'domains/' + 'evidence',
      'tools/evidence/' + 'evidenceBundleToolContextAdapter',
    ];
    for (const file of files) {
      const source = await fsp.readFile(file, 'utf-8');
      if (forbiddenImports.some((forbiddenImport) => source.includes(forbiddenImport))) {
        violations.push(path.relative(webRoot, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
