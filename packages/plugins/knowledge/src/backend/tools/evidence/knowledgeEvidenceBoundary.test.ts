import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function collectProductionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') {
        files.push(...await collectProductionTypeScriptFiles(fullPath));
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Knowledge → Evidence domain 边界', () => {
  it('插件业务只经过公开捕获端口，不依赖 Host Evidence 存储', async () => {
    const repositoryRoot = process.cwd();
    const knowledgeRoots = [
      path.join(repositoryRoot, 'packages/plugins/knowledge/src/backend'),
    ];
    const forbiddenImports = [
      'domains/' + 'evidence',
      'evidence/' + 'evidenceBundleToolContextAdapter',
    ];
    const violations: string[] = [];

    for (const root of knowledgeRoots) {
      const files = await collectProductionTypeScriptFiles(root);
      for (const file of files) {
        const source = await fsp.readFile(file, 'utf-8');
        if (forbiddenImports.some((forbiddenImport) => source.includes(forbiddenImport))) {
          violations.push(path.relative(repositoryRoot, file));
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
