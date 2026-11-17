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
  it('只允许工具组合 adapter 依赖 Evidence 写入边界', async () => {
    const repositoryRoot = process.cwd();
    const knowledgeRoots = [
      path.join(repositoryRoot, 'src/features/knowledge-base'),
      path.join(repositoryRoot, 'src/tools/knowledgebase'),
    ];
    const allowedAdapter = path.join(
      repositoryRoot,
      'src/tools/knowledgebase/evidence/knowledgeEvidenceBundleAdapter.ts',
    );
    const forbiddenImports = [
      'domains/' + 'evidence',
      'evidence/' + 'evidenceBundleToolContextAdapter',
    ];
    const violations: string[] = [];

    for (const root of knowledgeRoots) {
      const files = await collectProductionTypeScriptFiles(root);
      for (const file of files) {
        if (file === allowedAdapter) continue;
        const source = await fsp.readFile(file, 'utf-8');
        if (forbiddenImports.some((forbiddenImport) => source.includes(forbiddenImport))) {
          violations.push(path.relative(repositoryRoot, file));
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
